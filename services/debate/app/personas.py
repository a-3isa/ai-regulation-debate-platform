"""Add, edit and remove council members (Week 2 personas) over HTTP.

    GET    /personas              every member, with its derived stakeholder tag
    GET    /personas/vocabulary   the controlled vocabularies an editor offers
    POST   /personas              create a member
    PUT    /personas/{id}         replace a member (the id is immutable)
    DELETE /personas/{id}         remove a member
    POST   /personas/reset        restore the shipped members, discarding edits

WHERE MEMBERS LIVE
A persona is a YAML file in Week 3's vendored Week 2 persona directory, and that
directory is the single source of truth: the agent loop re-reads a member's file
on every turn and the graph builder globs the directory. So this module writes
the same files the engine reads - there is no second persona store to drift out
of sync. In production the directory is a volume, so edits survive a redeploy.

VALIDATION IS THE ENGINE'S OWN
Every write is validated with Week 2's strict `Persona` model before touching
disk, plus the one check that model cannot make alone: that the member's own
stakeholder tag can be derived (a tie for its maximum affinity is ambiguous and
would make the graph builder raise mid-debate). A member that would break a
debate is rejected here, with the reason, instead of failing later.

NO EDITS DURING A DEBATE
A running debate re-reads persona files each turn, so editing or deleting a
member mid-debate would change a speaker between rounds. Writes are refused
with 409 while any debate is running.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Callable

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app import logs

from src.graph.build_graph import PERSONAS_DIR, persona_stakeholder_tag
from src.vendor.week2.persona.loader import PersonaConfigError, load_all
from src.vendor.week2.persona.schema import (
    KNOWN_CATEGORIES,
    KNOWN_EXPERTISE_TOPICS,
    KNOWN_STAKEHOLDER_TAGS,
    Persona,
)

#: A pristine copy of the shipped members, taken at image build time, used by
#: POST /personas/reset. Absent in a local checkout, where reset is disabled.
DEFAULTS_DIR = Path(os.environ.get("PERSONA_DEFAULTS_DIR", "/week3/personas-defaults"))

#: A debate needs at least two voices to form a graph.
MIN_MEMBERS = 2

#: Canonical tool names from Week 2's tool registry.
KNOWN_TOOLS = ("rag_search", "web_search")

_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def build_router(active_runs: Callable[[], int]) -> APIRouter:
    """The persona routes. `active_runs` reports running debates, so writes can
    be refused while one is in progress."""
    router = APIRouter(prefix="/personas", tags=["personas"])

    def _refuse_if_debating() -> None:
        running = active_runs()
        if running:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"{running} debate{'s are' if running != 1 else ' is'} in progress. "
                    "Members are re-read on every turn, so changing one now would alter "
                    "a speaker mid-debate. Try again when it finishes."
                ),
            )

    @router.get("")
    def list_personas():
        return {"personas": [_describe(p) for p in _load().values()]}

    @router.get("/vocabulary")
    def vocabulary():
        return {
            "stakeholder_tags": sorted(KNOWN_STAKEHOLDER_TAGS),
            "expertise_topics": sorted(KNOWN_EXPERTISE_TOPICS),
            "categories": sorted(KNOWN_CATEGORIES),
            "tools": list(KNOWN_TOOLS),
            "levels": ["low", "medium", "high"],
            "min_members": MIN_MEMBERS,
            "reset_available": DEFAULTS_DIR.is_dir(),
        }

    @router.get("/{persona_id}")
    def get_persona(persona_id: str):
        personas = _load()
        if persona_id not in personas:
            raise HTTPException(status_code=404, detail=f"No member {persona_id}.")
        return _describe(personas[persona_id])

    @router.post("", status_code=201)
    def create_persona(payload: dict):
        _refuse_if_debating()
        payload = dict(payload or {})
        personas = _load()

        persona_id = (payload.get("id") or "").strip() or _slug(payload.get("name", ""))
        if not persona_id or not _ID_PATTERN.match(persona_id):
            raise HTTPException(
                status_code=422,
                detail={"errors": [{"field": "id", "message": (
                    "An id is lowercase letters, digits and underscores, starting with a letter "
                    "(e.g. data_protection_officer). It could not be derived from the name.")}]},
            )
        if persona_id in personas:
            raise HTTPException(
                status_code=409,
                detail=f"A member with id '{persona_id}' already exists; edit it or choose another name.",
            )

        payload["id"] = persona_id
        persona = _validate(payload)
        _write(persona)
        logs.info("member_created", member_id=persona_id, name=payload.get("name", ""))
        return _describe(persona)

    @router.put("/{persona_id}")
    def update_persona(persona_id: str, payload: dict):
        _refuse_if_debating()
        if persona_id not in _load():
            raise HTTPException(status_code=404, detail=f"No member {persona_id}.")
        payload = dict(payload or {})
        if payload.get("id") and payload["id"] != persona_id:
            raise HTTPException(
                status_code=422,
                detail={"errors": [{"field": "id", "message": (
                    "A member's id cannot change: past debates, memory and logs refer to it. "
                    "Create a new member instead.")}]},
            )
        payload["id"] = persona_id
        persona = _validate(payload)
        _write(persona)
        logs.info("member_updated", member_id=persona_id)
        return _describe(persona)

    @router.delete("/{persona_id}")
    def delete_persona(persona_id: str):
        _refuse_if_debating()
        personas = _load()
        if persona_id not in personas:
            raise HTTPException(status_code=404, detail=f"No member {persona_id}.")
        if len(personas) <= MIN_MEMBERS:
            raise HTTPException(
                status_code=409,
                detail=f"The council needs at least {MIN_MEMBERS} members to hold a debate.",
            )
        (PERSONAS_DIR / f"{persona_id}.yaml").unlink()
        logs.warning("member_deleted", member_id=persona_id, remaining=len(personas) - 1)
        return {"deleted": persona_id, "remaining": len(personas) - 1}

    @router.post("/reset")
    def reset_personas():
        _refuse_if_debating()
        if not DEFAULTS_DIR.is_dir():
            raise HTTPException(status_code=501, detail="No shipped defaults are available to restore.")
        for existing in PERSONAS_DIR.glob("*.yaml"):
            existing.unlink()
        for original in DEFAULTS_DIR.glob("*.yaml"):
            shutil.copy2(original, PERSONAS_DIR / original.name)
        restored = _load()
        logs.warning("members_reset", count=len(restored))
        return {"personas": [_describe(p) for p in restored.values()]}

    return router


# --- helpers ---------------------------------------------------------------


def _load() -> dict[str, Persona]:
    try:
        return load_all(PERSONAS_DIR)
    except PersonaConfigError as exc:
        # A hand-edited file on the volume is broken. Say which, rather than 500.
        raise HTTPException(status_code=500, detail=f"A member file on disk is invalid: {exc}")


def _slug(name: str) -> str:
    cleaned = re.sub(r"^(dr|prof|mr|mrs|ms)\.?\s+", "", (name or "").strip(), flags=re.I)
    slug = re.sub(r"[^a-z0-9]+", "_", cleaned.lower()).strip("_")
    if slug and not slug[0].isalpha():
        slug = f"member_{slug}"
    return slug[:48]


def _describe(persona: Persona) -> dict:
    data = persona.model_dump()
    try:
        data["stakeholder_tag"] = persona_stakeholder_tag(persona)
    except ValueError:
        data["stakeholder_tag"] = None
    data["builtin"] = (DEFAULTS_DIR / f"{persona.id}.yaml").exists()
    return data


def _validate(payload: dict) -> Persona:
    """Week 2's strict model, plus a derivable stakeholder tag."""
    # Fields the API adds for display must not be sent back into the model,
    # which forbids unknown keys.
    for key in ("stakeholder_tag", "builtin"):
        payload.pop(key, None)

    try:
        persona = Persona(**payload)
    except ValidationError as exc:
        raise HTTPException(
            status_code=422,
            detail={"errors": [
                {"field": ".".join(str(part) for part in err["loc"]), "message": err["msg"]}
                for err in exc.errors()
            ]},
        )

    try:
        persona_stakeholder_tag(persona)
    except ValueError:
        top = max(persona.retrieval.affinity.values(), default=None)
        raise HTTPException(
            status_code=422,
            detail={"errors": [{"field": "retrieval.affinity", "message": (
                "Give exactly one stakeholder perspective the highest weight - that is who this "
                "member represents, and it decides how much weight others give them. "
                + ("None are set." if top is None else f"Several are tied at {top}.")
            )}]},
        )
    return persona


def _write(persona: Persona) -> None:
    """Write the member atomically, in the same YAML the engine loads."""
    PERSONAS_DIR.mkdir(parents=True, exist_ok=True)
    target = PERSONAS_DIR / f"{persona.id}.yaml"
    temp = target.with_suffix(".yaml.tmp")
    temp.write_text(
        yaml.safe_dump(persona.model_dump(), sort_keys=False, allow_unicode=True, width=88),
        encoding="utf-8",
    )
    os.replace(temp, target)
