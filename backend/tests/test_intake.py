from datetime import date
from decimal import Decimal

from pydantic import ValidationError
import pytest

from app.financial import calculate
from app.intake import ExtractedClaim, ingest_b_claims
from app.schemas import CIRCLE, SourceSnapshot


def source(**updates):
    values = dict(id='registered-source', deal_id=CIRCLE.deal_id, entity_key=CIRCLE.entity_key,
                  provider='uploaded', source_kind='user_uploaded_pdf',
                  source_uri='upload://registered-source/report.pdf', sha256='a' * 64)
    values.update(updates)
    return SourceSnapshot(**values)


def claim(**updates):
    values = dict(source_id='registered-source', metric_key='reported.revenue', label='Revenue',
                  raw_value='1,234.50', unit='USD', currency='USD', scale_multiplier='1000',
                  normalization_basis='Document explicitly labels thousand USD',
                  locator={'kind': 'pdf_page', 'page': 3, 'quote': 'Revenue 1,234.50'},
                  verification_status='source_located', extractor_version='b-pdf-v1')
    values.update(updates)
    return ExtractedClaim(**values)


def test_server_computes_decimal_and_preserves_b_evidence_without_reregistering_sources():
    packet = claim(locator={'kind': 'pdf_page', 'page': 3, 'line_start': 4, 'line_end': 6,
                           'extraction_basis': 'PyMuPDF text lines, version supplied by B',
                           'extracted_line_count': 20, 'quote': 'Revenue 1,234.50', 'bbox': [10, 20, 90, 40]})
    result = ingest_b_claims(CIRCLE, [packet], [source()])
    observation = result.observations[0]
    assert observation.value == Decimal('1234500.00')
    assert observation.raw_value == '1,234.50' and observation.normalization_status == 'confirmed'
    assert observation.provider == 'uploaded' and observation.entity_key == CIRCLE.entity_key
    assert observation.locator['quote'] == packet.locator['quote']
    assert observation.locator['bbox'] == packet.locator['bbox']
    assert observation.locator['extracted_line_count'] == 20
    assert observation.locator['extractor_version'] == 'b-pdf-v1'
    assert result.snapshots == [] and result.company == CIRCLE and result.profile is None


def test_no_client_final_number_or_provider_or_company_override_is_accepted():
    for name, value in [('value', '999999'), ('provider', 'akta'), ('deal_id', 'foreign')]:
        with pytest.raises(ValidationError):
            ExtractedClaim(**{**claim().model_dump(), name: value})


@pytest.mark.parametrize('locator', [
    {'kind': 'pdf_page', 'page': 0},
    {'kind': 'pdf_page', 'page': True},
    {'kind': 'pdf_page', 'page': 1, 'line_start': 1, 'line_end': 2},
    {'kind': 'pdf_page', 'page': 1, 'line_start': 2, 'line_end': 1, 'extraction_basis': 'B text'},
    {'kind': 'pdf_page', 'page': 1, 'line_start': 1, 'line_end': 4, 'extraction_basis': 'B text', 'extracted_line_count': 3},
    {'kind': 'json_pointer', 'pointer': 'not/a/pointer'},
    {'kind': 'json_pointer', 'pointer': '/bad~2escape'},
    {'kind': 'xlsx_cell', 'sheet': 'Sheet1', 'cell': 'A0'},
    {'kind': 'xlsx_cell', 'sheet': 'Sheet1', 'cell': 'XFE1'},
    {'kind': 'csv_row', 'row': -1},
    {'kind': 'text_lines', 'line_start': 1, 'line_end': 2},
])
def test_invalid_locators_are_rejected_without_invented_source_locations(locator):
    with pytest.raises(ValidationError):
        claim(locator=locator)


@pytest.mark.parametrize('locator', [
    {'kind': 'json_pointer', 'pointer': '/data/financials/revenue~1usd'},
    {'kind': 'json_pointer', 'pointer': ''},
    {'kind': 'xlsx_cell', 'sheet': 'P&L', 'cell': 'XFD1048576'},
    {'kind': 'csv_row', 'row': 2, 'column': 'mrr'},
    {'kind': 'text_lines', 'line_start': 1, 'line_end': 2, 'extraction_basis': 'UTF-8 file lines'},
])
def test_supported_locator_contracts_are_preserved(locator):
    result = ingest_b_claims(CIRCLE, [claim(locator=locator)], [source()])
    assert all(result.observations[0].locator[k] == v for k, v in locator.items())


@pytest.mark.parametrize('registered', [[], [source(deal_id='another-deal')], [source(entity_key='another-entity')]])
def test_unknown_or_foreign_registered_sources_are_rejected(registered):
    with pytest.raises(ValueError):
        ingest_b_claims(CIRCLE, [claim()], registered)


@pytest.mark.parametrize('changes', [
    {'unit': None}, {'scale_multiplier': None}, {'normalization_basis': None},
    {'raw_value': '12M'}, {'raw_value': 'NaN'}, {'raw_value': '1,23'},
])
def test_missing_metadata_or_nonexact_raw_numbers_remain_unresolved(changes):
    result = ingest_b_claims(CIRCLE, [claim(**changes)], [source()])
    row = result.observations[0]
    assert row.value is None and row.normalization_status == 'unresolved'


@pytest.mark.parametrize('raw', [None, '', 'n.a.'])
def test_missing_raw_is_a_gap_not_zero(raw):
    row = ingest_b_claims(CIRCLE, [claim(raw_value=raw)], [source()]).observations[0]
    assert row.value is None and row.normalization_status == 'missing'


def test_parentheses_percent_and_explicit_scale_are_not_guessed():
    negative = ingest_b_claims(CIRCLE, [claim(raw_value='(1,234.50)')], [source()]).observations[0]
    assert negative.value == Decimal('-1234500.00')
    packet = claim(raw_value='13.218%', unit='ratio', currency=None, scale_multiplier='0.01',
                   normalization_basis='Percent points explicitly converted to fraction')
    ratio = ingest_b_claims(CIRCLE, [packet], [source()]).observations[0]
    assert ratio.value == Decimal('0.13218')
    unknown = packet.model_copy(update={'scale_multiplier': None})
    assert ingest_b_claims(CIRCLE, [unknown], [source()]).observations[0].value is None


def test_akta_estimate_context_never_becomes_an_exact_historical_point():
    registered = source(provider='akta', source_kind='provider_json_api',
                        context={'financial_kind': 'provider_estimate_not_audited_statement'})
    row = ingest_b_claims(CIRCLE, [claim(raw_value='100', scale_multiplier='1000000')], [registered]).observations[0]
    assert row.provider == 'akta' and row.value is None
    assert row.normalization_status == 'unresolved' and any('estimate' in note for note in row.notes)


def test_reviewed_definition_keys_enable_math_without_label_based_inference():
    packet = claim(raw_value='800000.01', scale_multiplier='1', definition_key='active_mrr',
                   period_kind='instant', period_end=date(2026, 9, 30),
                   scope='consolidated', accounting_basis='defined_recurring_revenue_policy', scenario='actual')
    result = ingest_b_claims(CIRCLE, [packet], [source()])
    calculation = calculate('arr', result.observations, {}, CIRCLE.deal_id)
    assert calculation.status == 'succeeded' and calculation.value == Decimal('9600000.12')
    assert ingest_b_claims(CIRCLE, [claim(label='ARR')], [source()]).observations[0].definition_key is None
    with pytest.raises(ValidationError, match='reviewed shared definition'):
        claim(definition_key='guess_from_label')


def test_observation_identity_tracks_source_extractor_and_metadata_and_replays_stably():
    packet = claim()
    a = ingest_b_claims(CIRCLE, [packet, packet], [source()])
    assert len(a.observations) == 1
    assert a == ingest_b_claims(CIRCLE, [packet], [source()])
    b = ingest_b_claims(CIRCLE, [claim(extractor_version='b-pdf-v2')], [source()])
    c = ingest_b_claims(CIRCLE, [claim(raw_value='1234.51')], [source()])
    assert len({a.observations[0].id, b.observations[0].id, c.observations[0].id}) == 3


@pytest.mark.parametrize('scale', ['0', '-1', 'NaN', 'Infinity'])
def test_invalid_normalization_scale_is_rejected(scale):
    with pytest.raises(ValidationError):
        claim(scale_multiplier=scale)
