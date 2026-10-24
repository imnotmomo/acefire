"""Member B → C evidence contract; this module never opens or parses a PDF.

B supplies extracted facts and native locators. C validates their shape,
normalizes explicit units with Decimal, and stores source-linked observations.
``definition_key`` is only a reference to C's reviewed shared definition
registry. Its presence must not be inferred from labels by this intake module.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, DecimalException, InvalidOperation, localcontext
import re
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.financial import DEFINITIONS, OUTPUT_DEFINITIONS
from app.schemas import Company, Contract, IngestionResult, Observation, SourceSnapshot, stable_id


REVIEWED_DEFINITION_KEYS = frozenset(key for keys in DEFINITIONS.values() for key in keys) | frozenset(OUTPUT_DEFINITIONS.values())
_MISSING = {'', 'n.a.', 'n.a', 'n/a', 'n.s.', 'n.s', 'null', 'none', '—', '–', '-'}


class ExtractedClaim(Contract):
    """B's extraction packet. C calculates value; a client ``value`` is forbidden.

    Locators retain quotes, bbox coordinates and any extractor line counts.
    PDF text line numbers require an explicit extraction basis and refer to
    that extraction's line ordering, not universal lines inherent to the PDF.
    Canonical definition keys must be chosen from C's reviewed registry only.
    """
    raw_value: str | None = Field(default=None, max_length=4096)
    source_id: str = Field(min_length=1, max_length=256)
    metric_key: str = Field(min_length=1, max_length=256)
    label: str = Field(min_length=1, max_length=1024)
    unit: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, pattern=r'^[A-Z]{3}$')
    scale_multiplier: Decimal | None = Field(default=None, gt=0, allow_inf_nan=False)
    normalization_basis: str | None = Field(default=None, max_length=4096)
    definition_key: str | None = None
    scope: str | None = None
    accounting_basis: str | None = None
    period_kind: Literal['instant', 'duration', 'unknown'] = 'unknown'
    period_start: date | None = None
    period_end: date | None = None
    period_label: str | None = None
    scenario: Literal['actual', 'forecast', 'unknown'] = 'unknown'
    locator: dict[str, Any]
    verification_status: Literal['source_located', 'manual_capture', 'api_reported', 'needs_review'] = 'needs_review'
    notes: list[str] = Field(default_factory=list)
    extractor_version: str = Field(min_length=1, max_length=256)

    @field_validator('source_id', 'metric_key', 'label', 'extractor_version')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Extraction identity and labels must not be blank.')
        return value

    @field_validator('definition_key')
    @classmethod
    def reviewed_definition(cls, value):
        if value is not None and value not in REVIEWED_DEFINITION_KEYS:
            raise ValueError('definition_key must reference C\'s reviewed shared definition registry; no semantic mapping is inferred.')
        return value

    @model_validator(mode='after')
    def coherent_period(self):
        if self.period_kind == 'unknown':
            valid = self.period_start is None and self.period_end is None
        elif self.period_kind == 'instant':
            valid = self.period_start is None and self.period_end is not None
        else:
            valid = self.period_start is not None and self.period_end is not None and self.period_start <= self.period_end
        if not valid:
            raise ValueError('Exact period fields must match period_kind; an unknown period has null dates.')
        _validate_locator(self.locator)
        if self.locator.get('extractor_version', self.extractor_version) != self.extractor_version:
            raise ValueError('Locator and packet extractor versions differ.')
        return self


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _lines(locator: dict[str, Any], required: bool):
    start, end = locator.get('line_start'), locator.get('line_end')
    if not required and start is None and end is None:
        return
    if not (_positive_int(start) and _positive_int(end) and start <= end):
        raise ValueError('Line locators require a paired positive 1-based line_start/line_end range.')
    basis = locator.get('extraction_basis')
    if not isinstance(basis, str) or not basis.strip():
        raise ValueError('Line numbers require an explicit extraction_basis; PDF lines are extractor dependent.')
    if 'extracted_line_count' in locator:
        count = locator['extracted_line_count']
        if not _positive_int(count) or end > count:
            raise ValueError('Line range exceeds the declared extracted_line_count.')


def _validate_locator(locator: dict[str, Any]):
    kind = locator.get('kind')
    if kind == 'pdf_page':
        if not _positive_int(locator.get('page')):
            raise ValueError('PDF page must be a positive 1-based integer.')
        _lines(locator, False)
    elif kind == 'json_pointer':
        pointer = locator.get('pointer')
        if not isinstance(pointer, str) or (pointer and not pointer.startswith('/')) or re.search(r'~(?![01])', pointer):
            raise ValueError('JSON pointer must be empty or start with / and use only ~0/~1 escapes.')
    elif kind == 'xlsx_cell':
        sheet, cell = locator.get('sheet'), locator.get('cell')
        if not isinstance(sheet, str) or not sheet.strip() or not isinstance(cell, str):
            raise ValueError('XLSX locator requires a sheet and A1-style cell.')
        match = re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]{0,6})', cell)
        if match is None:
            raise ValueError('XLSX cell must use 1-based A1 notation.')
        column = 0
        for char in match.group(1):
            column = column * 26 + ord(char) - ord('A') + 1
        if column > 16384 or int(match.group(2)) > 1048576:
            raise ValueError('XLSX cell exceeds Excel worksheet bounds.')
    elif kind == 'text_lines':
        _lines(locator, True)
    elif kind == 'csv_row':
        if not _positive_int(locator.get('row')):
            raise ValueError('CSV row must be a positive 1-based integer.')
        if 'column' in locator and not (_positive_int(locator['column']) or isinstance(locator['column'], str) and locator['column'].strip()):
            raise ValueError('CSV column must be a positive index or nonblank column name.')
    else:
        raise ValueError('Supported locator kinds: pdf_page, json_pointer, xlsx_cell, text_lines, csv_row.')
    if 'quote' in locator and not isinstance(locator['quote'], str):
        raise ValueError('A source quote must be text.')
    if 'bbox' in locator:
        bounds = locator['bbox']
        if not isinstance(bounds, (list, tuple)) or len(bounds) != 4 or any(isinstance(v, bool) for v in bounds):
            raise ValueError('bbox must contain four finite coordinates.')
        try:
            x0, y0, x1, y1 = [Decimal(str(value)) for value in bounds]
            if not all(v.is_finite() for v in (x0, y0, x1, y1)) or x0 > x1 or y0 > y1:
                raise ValueError
        except (InvalidOperation, ValueError):
            raise ValueError('bbox must contain four finite, ordered coordinates.') from None


def _raw_decimal(raw: str) -> Decimal | None:
    text = raw.strip().replace('−', '-')
    if text.endswith('%'):
        text = text[:-1].strip()  # Conversion still requires an explicit scale.
    if text.startswith('(') and text.endswith(')'):
        text = '-' + text[1:-1].strip()
    # Commas are thousands separators only when their grouping is explicit.
    if ',' in text and not re.fullmatch(r'[+-]?[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?', text):
        return None
    try:
        number = Decimal(text.replace(',', ''))
        if not number.is_finite() or len(number.as_tuple().digits) > 4096 or abs(number.as_tuple().exponent) > 1000:
            return None
        return number
    except InvalidOperation:
        return None


def _akta_estimate(source: SourceSnapshot, claim: ExtractedClaim) -> bool:
    if source.provider != 'akta':
        return False
    context = str(source.context.get('financial_kind', '')).casefold()
    pointer = str(claim.locator.get('pointer', '')).casefold()
    return ('estimate' in context or bool(source.context.get('is_estimate'))
            or 'financial_estimate' in pointer or 'estimate' in claim.metric_key.casefold()
            or 'estimate' in source.source_kind.casefold())


def ingest_b_claims(
    company: Company,
    claims: list[ExtractedClaim],
    snapshots: list[SourceSnapshot],
) -> IngestionResult:
    """Normalize B's extracted facts against already registered source IDs.

    Source ownership/provider comes from the server's snapshot registry. No
    caller-supplied final number, company ID or provider replaces those facts.
    C validates declared locators, not the contents of the underlying document.
    """
    by_id = {source.id: source for source in snapshots}
    if len(by_id) != len(snapshots):
        raise ValueError('Registered source snapshot IDs must be unique.')
    observations = []
    warnings = []
    seen = set()
    for claim in claims:
        source = by_id.get(claim.source_id)
        if source is None:
            raise ValueError('B claim references an unknown registered source snapshot.')
        if (source.deal_id, source.entity_key) != (company.deal_id, company.entity_key):
            raise ValueError('B claim source belongs to another deal or entity.')
        # Validate even if a trusted Python caller constructed via model_copy.
        claim = ExtractedClaim.model_validate(claim.model_dump(mode='json'))
        locator = deepcopy(claim.locator)
        locator['extractor_version'] = claim.extractor_version
        notes = list(claim.notes) + [
            'Location and extracted text supplied by B; C validates locator structure and arithmetic without parsing the source document.',
        ]
        raw = claim.raw_value
        missing = raw is None or raw.strip().casefold() in _MISSING
        status = 'missing' if missing else 'unresolved'
        value = None
        number = None if missing else _raw_decimal(raw)
        explicit_metadata = bool(claim.unit and claim.unit.strip()
                                 and claim.scale_multiplier is not None
                                 and claim.normalization_basis and claim.normalization_basis.strip())
        if _akta_estimate(source, claim):
            notes.append('Akta estimate context retained as an estimate; no exact historical point value or range midpoint was created.')
        elif number is not None and explicit_metadata:
            try:
                with localcontext() as context:
                    context.prec = max(50, len(number.as_tuple().digits) + len(claim.scale_multiplier.as_tuple().digits))
                    value = number * claim.scale_multiplier
                if value.is_finite():
                    status = 'confirmed'
                else:
                    value = None
            except DecimalException:
                value = None
                notes.append('Numeric value exceeds supported exact normalization limits.')
        elif not missing:
            notes.append('Normalization unresolved: a finite raw decimal and explicit unit, positive scale and normalization basis are required; no K/M or percentage scale is guessed.')
        observation_id = stable_id('b-extracted-claim-v1', source.id, source.sha256,
                                   company.deal_id, company.entity_key,
                                   claim.model_dump(mode='json'))
        if observation_id in seen:
            continue
        seen.add(observation_id)
        observations.append(Observation(
            id=observation_id, deal_id=source.deal_id, entity_key=source.entity_key,
            snapshot_id=source.id, provider=source.provider, metric_key=claim.metric_key,
            raw_label=claim.label, raw_value=raw, value=value,
            unit=claim.unit, currency=claim.currency,
            scale_multiplier=claim.scale_multiplier,
            normalization_status=status, normalization_basis=claim.normalization_basis,
            definition_key=claim.definition_key, scope=claim.scope,
            accounting_basis=claim.accounting_basis, period_kind=claim.period_kind,
            period_start=claim.period_start, period_end=claim.period_end,
            period_label=claim.period_label, scenario=claim.scenario,
            information_as_of=source.provider_as_of,
            verification_status=claim.verification_status, locator=locator, notes=notes,
        ))
    if any(o.normalization_status == 'unresolved' for o in observations):
        warnings.append('Some extracted facts lack confirmed normalization or are provider estimates; their numeric value remains null.')
    return IngestionResult(company=company, snapshots=[], observations=observations,
                           profile=None, warnings=warnings)
