"""Strict B-side extraction contracts; shared database mapping remains separate."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Support(StrictModel):
    physical_page: int = Field(ge=1)
    section: str | None
    quote: str = Field(min_length=10)


class NumericFact(StrictModel):
    """Source-reported candidate; C retains ownership of normalization."""
    metric_key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    raw_value: str = Field(min_length=1)
    unit: str | None
    currency: str | None = Field(pattern=r'^[A-Z]{3}$')
    scale_multiplier: str | None
    normalization_basis: str | None
    scope: str | None
    accounting_basis: str | None
    period_kind: Literal['instant', 'duration', 'unknown']
    period_start: str | None
    period_end: str | None
    period_label: str | None
    scenario: Literal['actual', 'forecast', 'unknown']

class ExtractedClaim(StrictModel):
    subject_entity_id: str | None = Field(min_length=1)
    subject_entity_name: str | None = Field(default=None, min_length=1)
    claim_type: Literal["parties", "effective_date", "scope", "obligation", "term", "renewal", "termination", "redaction",
                        "business", "product", "market", "customer", "team", "compliance", "definition", "other_nonfinancial", "financial", "operating_metric"]
    statement: str = Field(min_length=1)
    effective_date: str | None = Field(json_schema_extra={"format": "date"})
    evidence: list[Support] = Field(min_length=1)
    limitations: list[str]
    numeric: NumericFact | None = None

    @model_validator(mode="after")
    def unresolved_entity_has_name(self):
        if self.subject_entity_id is None and not (self.subject_entity_name or "").strip():
            raise ValueError("Unresolved subjects require subject_entity_name")
        return self

    @field_validator("effective_date")
    @classmethod
    def valid_date(cls, value):
        if value is not None and date.fromisoformat(value).isoformat() != value:
            raise ValueError("Use YYYY-MM-DD dates")
        return value


class Extraction(StrictModel):
    claims: list[ExtractedClaim]
    open_questions: list[str]
