from __future__ import annotations

from pathlib import Path

import yaml

from .schema import Persona


class PersonaConfigError(Exception):
    """A member file on disk could not be read as a persona."""


def load_all(directory: Path) -> dict[str, Persona]:
    personas: dict[str, Persona] = {}
    if not Path(directory).is_dir():
        return personas
    for path in sorted(Path(directory).glob("*.yaml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            persona = Persona(**data)
        except Exception as exc:  # noqa: BLE001 - the loader's job is to say which file
            raise PersonaConfigError(f"{path.name}: {exc}")
        personas[persona.id] = persona
    return personas
