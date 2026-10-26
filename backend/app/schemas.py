"""Shared contracts for source intake, deterministic calculations and B's query tools."""
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import NAMESPACE_URL, uuid5

from pydantic import BaseModel, ConfigDict, Field, model_serializer


def stable_id(*parts: object) -> str:
    import json
    return str(uuid5(NAMESPACE_URL, json.dumps(parts, sort_keys=True, default=str)))


class Contract(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Company(Contract):
    deal_id: str
    entity_key: str
    legal_name: str
    domain: str
    country: str
    historical_cutoff: date | None = None
    identifiers: dict[str, str] = Field(default_factory=dict)
    primary_provider: Literal['akta'] = 'akta'
    primary_company_id: str | None = None


CIRCLE = Company(
    deal_id='circle-2025-ipo', entity_key='circle-internet-group-inc',
    legal_name='Circle Internet Group, Inc.', domain='circle.com', country='USA',
    historical_cutoff=date(2025, 5, 27),
    identifiers={'cik': '0001876042', 'orbis': '674047230', 'bvd': 'US992840247', 'pitchbook': '60145-57'},
)


class SourceSnapshot(Contract):
    id: str
    deal_id: str
    entity_key: str
    provider: Literal['orbis', 'pitchbook', 'akta', 'uploaded']
    ingestion_channel: Literal['provider_api', 'user_upload'] = 'user_upload'
    data_role: Literal['primary_company_data', 'supplemental_evidence'] = 'supplemental_evidence'
    visibility: Literal['deal_private'] = 'deal_private'
    original_filename: str | None = None
    uploaded_at: datetime | None = None
    source_kind: str
    source_uri: str
    local_path: str | None = None
    sha256: str
    retrieved_at: datetime | None = None
    provider_as_of: date | None = None
    context: dict[str, Any] = Field(default_factory=dict)


class Observation(Contract):
    id: str
    deal_id: str
    entity_key: str
    snapshot_id: str
    provider: Literal['orbis', 'pitchbook', 'akta', 'uploaded']
    metric_key: str
    raw_label: str
    raw_value: str | None = None
    value: Decimal | None = None
    unit: str | None = None
    currency: str | None = None
    scale_multiplier: Decimal | None = None
    normalization_status: Literal['confirmed', 'unresolved', 'missing'] = 'unresolved'
    normalization_basis: str | None = None
    reviewed_from_id: str | None = None
    definition_key: str | None = None
    scope: str | None = None
    accounting_basis: str | None = None
    period_kind: Literal['instant', 'duration', 'unknown'] = 'unknown'
    period_label: str | None = None
    period_start: date | None = None
    period_end: date | None = None
    scenario: Literal['actual', 'forecast', 'unknown'] = 'unknown'
    information_as_of: date | None = None
    verification_status: Literal['source_located', 'manual_capture', 'api_reported', 'needs_review'] = 'needs_review'
    locator: dict[str, Any]
    quarantined: bool = False
    notes: list[str] = Field(default_factory=list)

    @model_serializer(mode='wrap')
    def preserve_historical_payload(self, handler):
        record = handler(self)
        if self.reviewed_from_id is None:
            # Keep existing immutable payloads byte-equivalent on replay, also
            # on the supported older Pydantic releases without exclude_if.
            record.pop('reviewed_from_id', None)
        return record


class IngestionResult(Contract):
    company: Company
    snapshots: list[SourceSnapshot]
    observations: list[Observation]
    profile: dict[str, Any] | None = None
    profiles: dict[str, dict[str, Any]] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class Comparison(Contract):
    id: str
    deal_id: str
    lhs_id: str
    rhs_id: str
    status: Literal['matched', 'value_mismatch', 'not_comparable', 'insufficient_evidence']
    delta: Decimal | None = None
    relative_delta: Decimal | None = None
    tolerance: Decimal | None = None
    reason_codes: list[str] = Field(default_factory=list)
    checks: dict[str, Any] = Field(default_factory=dict)
    policy_version: str = 'context-v1'


class Calculation(Contract):
    id: str
    deal_id: str
    metric_key: str
    function_key: str
    formula: str
    status: Literal['succeeded', 'insufficient_data', 'not_applicable']
    value: Decimal | None = None
    unit: str | None = None
    input_ids: list[str] = Field(default_factory=list)
    input_snapshots: list[str] = Field(default_factory=list)
    parameters: dict[str, Any] = Field(default_factory=dict)
    reasons: list[str] = Field(default_factory=list)
    function_version: str = '1'
