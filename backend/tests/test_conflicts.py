from calendar import monthrange
from datetime import date
from decimal import Decimal
import os
from pathlib import Path

from app.conflicts import annotate_calculation_conflicts, detect_conflicts
from app.dynamic import calculate_revenue_dynamic
from app.local_sources import ingest_local_circle
from app.schemas import CIRCLE, Observation, SourceSnapshot
from app.source_replay import replay_balance_sheet


def observation(identifier='a', **updates):
    fields = dict(id=identifier, deal_id='deal', entity_key='company', snapshot_id='source', provider='uploaded',
                  metric_key='uploaded.revenue', raw_label='Revenue', raw_value='100', value=Decimal(100),
                  unit='USD', currency='USD', scale_multiplier=Decimal(1), normalization_status='confirmed',
                  normalization_basis='Source USD', definition_key='recognized_revenue', scope='consolidated',
                  accounting_basis='US_GAAP', period_kind='duration', period_start=date(2024,1,1), period_end=date(2024,12,31),
                  scenario='actual', verification_status='source_located', locator={'kind':'csv_row','row':2})
    fields.update(updates)
    return Observation(**fields)


def source():
    return SourceSnapshot(id='source',deal_id='deal',entity_key='company',provider='uploaded',source_kind='user_uploaded_csv',
                          source_uri='upload://source/revenue.csv',sha256='a'*64,original_filename='revenue.csv')


def test_comparable_point_conflict_preserves_source_proof_and_never_selects_authority():
    a,b = observation(), observation('b',raw_value='101',value=Decimal(101))
    events = detect_conflicts([a,b],[source()])
    assert len(events)==1 and events[0]['kind']=='value_conflict'
    assert events[0]['status']=='conflict_numbers' and not events[0]['authoritative_value_selected']
    assert {alternative['value'] for alternative in events[0]['alternatives']}=={'100','101'}
    proof = events[0]['alternatives'][0]['sources'][0]
    assert proof['sha256']=='a'*64 and proof['file_name']=='revenue.csv' and proof['locator']['kind']=='csv_row'
    assert [a.value,b.value]==[Decimal(100),Decimal(101)]


def test_unknown_context_requires_review_without_numeric_delta_or_namespace_aliases():
    a=observation(definition_key=None,scope=None)
    b=observation('b',definition_key=None,scope=None,value=Decimal(101))
    events=detect_conflicts([a,b],[source()])
    assert events[0]['kind']=='comparability_review' and events[0]['delta'] is None
    assert detect_conflicts([a,b.model_copy(update={'metric_key':'pitchbook.total_revenue'})],[source()])==[]


def test_distinct_periods_and_unknown_ttm_labels_never_collapse_into_false_conflicts():
    a=observation()
    b=observation('b',period_start=date(2023,1,1),period_end=date(2023,12,31),value=Decimal(101))
    assert detect_conflicts([a,b],[source()])==[]
    a=a.model_copy(update={'period_kind':'unknown','period_start':None,'period_end':None,'period_label':'TTM Dec 2025','definition_key':None})
    b=b.model_copy(update={'period_kind':'unknown','period_start':None,'period_end':None,'period_label':'TTM Jun 2026','definition_key':None})
    assert detect_conflicts([a,b],[source()])==[]


def test_identical_values_from_distinct_observations_are_not_number_conflicts():
    assert detect_conflicts([observation(),observation('b')],[source()])==[]


def test_dynamic_calculation_succeeds_and_is_annotated_after_annual_disagreement():
    annual=observation('annual',raw_value='1300',value=Decimal(1300))
    months=[observation('month-'+str(m),period_start=date(2024,m,1),period_end=date(2024,m,monthrange(2024,m)[1])) for m in range(1,13)]
    rows=[annual]+months
    calculation=calculate_revenue_dynamic(rows,'deal')
    assert calculation.status=='succeeded' and calculation.value==Decimal(1200)
    flags=annotate_calculation_conflicts(calculation,rows,[source()])
    assert flags['conflict_numbers'] and flags['conflicts'][0]['kind']=='aggregate_value_conflict'
    assert flags['conflicts'][0]['delta']=='-100'
    assert len(flags['conflicts'][0]['observation_ids'])==13
    matching=[annual.model_copy(update={'value':Decimal(1200),'raw_value':'1200'})]+months
    assert not annotate_calculation_conflicts(calculation,matching,[source()])['conflict_numbers']
    assert annual.value==Decimal(1300)


def test_missing_months_are_coverage_gaps_not_numeric_disagreement():
    annual=observation('annual',value=Decimal(1300))
    january=observation('january',period_start=date(2024,1,1),period_end=date(2024,1,31))
    assert detect_conflicts([annual,january],[source()])==[]


def test_real_asset_replay_baseline_has_no_flag_but_changed_reported_value_does():
    root=Path(os.environ.get('DATA_ROOT',str(Path(__file__).resolve().parents[2]/'data'/'additional-cases')))
    result=ingest_local_circle(root/CIRCLE.deal_id)
    calculation=replay_balance_sheet(result.observations,CIRCLE.deal_id,date(2024,12,31))
    assert calculation.status=='succeeded'
    assert not annotate_calculation_conflicts(calculation,result.observations,result.snapshots)['conflict_numbers']
    changed=[o.model_copy(update={'value':o.value+Decimal(1)}) if o.metric_key=='orbis.total_assets' and o.period_end==date(2024,12,31) else o for o in result.observations]
    flags=annotate_calculation_conflicts(calculation,changed,result.snapshots)
    assert flags['conflict_numbers'] and flags['conflicts'][0]['delta']=='-1'
    assert result.observations!=changed
    assert flags['conflicts'][0]['alternatives'][0]['sources'][0]['locator']['cell']=='I58'
