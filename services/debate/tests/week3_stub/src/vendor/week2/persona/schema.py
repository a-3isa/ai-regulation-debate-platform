"""Week 2's persona model, reduced to the parts the API validates against.

The real model has more fields and stricter vocabularies; what matters for the
API's own tests is that it forbids unknown keys, requires the fields the UI
sends, and exposes `retrieval.affinity` - those are the three things the
persona routes' error paths depend on.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

KNOWN_CATEGORIES = ("regulator", "industry", "civil_society", "academia")
KNOWN_EXPERTISE_TOPICS = ("ai_act", "privacy", "safety", "innovation")
KNOWN_STAKEHOLDER_TAGS = ("regulator", "industry", "civil_society", "academia")


class Retrieval(BaseModel):
    model_config = ConfigDict(extra="forbid")

    affinity: dict[str, float] = Field(default_factory=dict)


class Persona(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    background: str = Field(min_length=40)
    category: str = "regulator"
    retrieval: Retrieval = Field(default_factory=Retrieval)
