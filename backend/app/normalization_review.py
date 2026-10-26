"""Explicit human normalization makes a new source-bound observation, never an edit."""
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import Field, field_validator

from app.intake import ExtractedClaim, ingest_b_claims
from app.schemas import Contract, stable_id


class NormalizationReview(Contract):
    metric_key: str = Field(min_length=1, max_length=256)
    unit: str = Field(min_length=1, max_length=100)
    currency: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    scale_multiplier: Decimal = Field(gt=0, allow_inf_nan=False)
    normalization_basis: str = Field(min_length=1, max_length=4096)
    definition_key: str | None = None
    scope: str | None = Field(default=None, max_length=1000)
    accounting_basis: str | None = Field(default=None, max_length=1000)
    period_kind: Literal['instant', 'duration', 'unknown']
    period_start: date | None = None
    period_end: date | None = None
    period_label: str | None = Field(default=None, max_length=1000)
    scenario: Literal['actual', 'forecast', 'unknown'] = 'unknown'

    @field_validator('scale_multiplier', mode='before')
    @classmethod
    def exact_scale(cls, value):
        if isinstance(value, (float, bool)):
            raise ValueError('Supply scale_multiplier as an exact decimal string, not a floating-point number.')
        return value

    @field_validator('scale_multiplier')
    @classmethod
    def bounded_scale(cls, value):
        if len(value.as_tuple().digits) > 4096 or abs(value.as_tuple().exponent) > 1000:
            raise ValueError('Scale multiplier exceeds exact normalization limits.')
        return value

    @field_validator('metric_key', 'unit', 'normalization_basis')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Normalization metadata must not be blank.')
        return value.strip()


def reviewed_observation(company, original, snapshots, request):
    if original.quarantined:
        raise ValueError('Quarantined source observations cannot be normalized for calculation.')
    claim = ExtractedClaim(**request.model_dump(), source_id=original.snapshot_id,
        raw_value=original.raw_value, label=original.raw_label, locator=original.locator,
        extractor_version=original.locator.get('extractor_version', 'human-normalization-review-v1'))
    result = ingest_b_claims(company, [claim], snapshots)
    normalized = result.observations[0]
    if normalized.normalization_status != 'confirmed' or normalized.value is None:
        raise ValueError('This raw value cannot be exactly normalized. A finite source decimal and explicit unit/scale are required; provider estimates remain unresolved.')
    return normalized.model_copy(update={
        'id': stable_id('human-normalization-review-v1', original.id, request.model_dump(mode='json')),
        'reviewed_from_id': original.id, 'locator': original.locator,
        'verification_status': 'needs_review', 'information_as_of': original.information_as_of,
        'notes': [*original.notes, 'Normalization metadata supplied explicitly by a user. Original raw value and source locator are retained; this review does not verify the source fact.'],
    })
