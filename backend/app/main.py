"""Local API for source-bound calculations and cited company analysis."""
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
import hashlib
import mimetypes
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field, model_validator

from app.akta import AktaClient, AktaError, ingest_akta_circle
from app.akta_saved import ingest_saved_akta_circle
from app.config import akta_data_root, cache_root, data_root, database_path
from app.financial import calculate, compare_observations
from app.local_sources import ingest_local_circle
from app.schemas import CIRCLE, Contract
from app.store import Store
from app.uploads import ingest_upload
from app.lineage import build_calculation_lineage, build_profile_lineage
from app.source_replay import replay_balance_sheet
from app.intake import ExtractedClaim, ingest_b_claims
from app.report import build_company_report
from app.dynamic import calculate_revenue_dynamic
from app.periods import build_period_coverage
from app.conflicts import annotate_calculation_conflicts, detect_conflicts
from app.agent_runtime import AgentSettings
from app.agent_calculation import AgentCalculationRequest, AgentCalculator, AgentCalculationError
from app.narrative import NarrativeDraftRequest, NarrativeGenerator, NarrativeError
from app.company_chat import CompanyChatRequest, CompanyChat
from app.evidence_catalog import add_document_claims, build_evidence_catalog
from app.stored_narratives import source_claims as stored_source_claims, summaries as stored_report_summaries, draft as stored_draft
from app.document_routes import document_router


class CompareRequest(Contract):
    lhs_id: str
    rhs_id: str
    tolerance: Decimal = Field(ge=0, allow_inf_nan=False)
    historical_view: bool = False


class CalculateRequest(Contract):
    metric_key: Literal['arr', 'revenue', 'monthly_net_burn', 'runway']
    input_ids: list[str] = Field(default_factory=list, max_length=1000)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ReplayRequest(Contract):
    period_end: date
    snapshot_id: str | None = None


class DynamicRevenueRequest(Contract):
    input_ids: list[str] = Field(default_factory=list, max_length=2000)
    target_start: date | None = None
    target_end: date | None = None

    @model_validator(mode='after')
    def validate_target_window(self):
        if (self.target_start is None) != (self.target_end is None):
            raise ValueError('Supply both target_start and target_end, or omit both.')
        if self.target_start is not None and self.target_end < self.target_start:
            raise ValueError('target_end must not precede target_start.')
        return self


class ClaimsBatchRequest(Contract):
    claims: list[ExtractedClaim] = Field(min_length=1, max_length=2000)


def create_app(store: Store | None = None, source_root: Path | None = None, akta_factory=None, saved_akta_root: Path | None = None, agent_factory=None, narrative_factory=None, chat_factory=None) -> FastAPI:
    if store is None and os.getenv('DATA_STORE', 'duckdb') == 'firestore':
        from app.firebase_store import FirebaseStore
        ledger = FirebaseStore()
    else:
        ledger = store or Store(database_path())
    root = source_root or data_root()
    akta_root = saved_akta_root or akta_data_root()
    factory = akta_factory or AktaClient

    @asynccontextmanager
    async def lifespan(_):
        ledger.initialize()
        try:
            yield
        finally:
            ledger.close()

    app = FastAPI(title='Acefire Data + Financial Engine', version='0.1.0', lifespan=lifespan)
    app.state.store = ledger
    app.include_router(document_router(ledger))

    def company(deal_id):
        value = ledger.company(deal_id)
        if value is None:
            raise HTTPException(404, 'Deal not found. Ingest the Circle case first.')
        return value

    def observation(deal_id, record_id):
        value = ledger.observation(record_id)
        if value is None or value.deal_id != deal_id:
            raise HTTPException(404, 'Observation not found in this deal.')
        return value

    def circle_only(deal_id):
        if getattr(ledger, 'backend', None) == 'firestore':
            raise HTTPException(501, 'New source ingestion is pending the teammate integration. Existing Firestore records remain available.')
        if deal_id != CIRCLE.deal_id:
            raise HTTPException(400, 'The initial source adapters support circle-2025-ipo. Add a reviewed company mapping for another case.')

    def calculation_payload(result):
        flags = annotate_calculation_conflicts(result, ledger.observations(result.deal_id), ledger.snapshots(result.deal_id))
        return {**result.model_dump(mode='json'), **flags, 'flags': ['conflict numbers'] if flags['conflict_numbers'] else []}

    def available_text_evidence(deal_id: str):
        return [{'id': item['id'], 'text': item['text'], 'source': item['source']}
                for item in company_report(deal_id)['narrative_evidence'] if item['kind'] == 'statement']

    @app.get('/health')
    def health():
        return {'status': 'ok', 'schema_version': 1, 'storage': getattr(ledger, 'backend', 'duckdb'),
                **({'project_id': ledger.project, 'database_id': ledger.database} if getattr(ledger, 'backend', None) == 'firestore' else {})}

    @app.get('/calculation-runtime')
    def calculation_runtime():
        return AgentSettings.from_environment().configuration_status()

    @app.post('/deals/{deal_id}/ingest/local')
    def ingest_local(deal_id: str):
        circle_only(deal_id)
        try:
            result = ingest_local_circle(root / deal_id)
            saved = ledger.ingest(result)
            return {**saved, 'company': result.company, 'warnings': result.warnings}
        except (ValueError, FileNotFoundError) as error:
            raise HTTPException(422, str(error)) from None

    @app.post('/deals/{deal_id}/ingest/akta')
    def ingest_remote(deal_id: str):
        circle_only(deal_id)
        client = None
        try:
            client = factory()
            result = ingest_akta_circle(client, cache_root())
            return {**ledger.ingest(result), 'company': result.company, 'warnings': result.warnings}
        except AktaError as error:
            raise HTTPException(424, {'source': 'akta', 'message': str(error), 'provider_status': error.status_code}) from None
        finally:
            if client:
                client.close()

    @app.post('/deals/{deal_id}/ingest/akta-saved')
    def ingest_saved_akta(deal_id: str):
        circle_only(deal_id)
        try:
            result = ingest_saved_akta_circle(akta_root)
            return {**ledger.ingest(result), 'company': result.company, 'warnings': result.warnings}
        except (AktaError, ValueError, FileNotFoundError) as error:
            raise HTTPException(422, str(error)) from None

    @app.post('/deals/{deal_id}/files')
    async def upload_file(deal_id: str, file: UploadFile = File(...), provider: Literal['orbis', 'pitchbook', 'uploaded'] = 'uploaded'):
        circle_only(deal_id)
        selected = ledger.company(deal_id) or CIRCLE
        try:
            content = await file.read(50 * 1024 * 1024 + 1)
            result = ingest_upload(content, file.filename or 'upload.bin', file.content_type, provider, selected, cache_root())
            return {**ledger.ingest(result), 'sources': result.snapshots, 'warnings': result.warnings}
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        finally:
            await file.close()

    @app.get('/sources/akta/mcp/tools')
    def mcp_tools():
        client = None
        try:
            client = factory()
            return client.mcp_tools()
        except AktaError as error:
            raise HTTPException(424, {'source': 'akta', 'message': str(error), 'provider_status': error.status_code}) from None
        finally:
            if client:
                client.close()

    @app.get('/deals/{deal_id}/sources')
    def sources(deal_id: str):
        company(deal_id)
        return ledger.snapshots(deal_id)

    @app.get('/deals/{deal_id}/profiles')
    def profiles(deal_id: str):
        company(deal_id)
        return ledger.profiles(deal_id)

    @app.get('/deals/{deal_id}/company-profile')
    def company_profile(deal_id: str):
        selected = company(deal_id)
        return {'company': selected, 'provenance': build_profile_lineage(ledger.profiles(deal_id), ledger.snapshots(deal_id))}

    @app.get('/deals/{deal_id}/text-evidence')
    def text_evidence(deal_id: str):
        company(deal_id)
        return {'evidence': available_text_evidence(deal_id), 'basis': 'stored_primary_profile_and_document_quotations'}

    @app.get('/sources/{snapshot_id}/file')
    def source_file(snapshot_id: str):
        source = ledger.snapshot(snapshot_id)
        if source is None:
            raise HTTPException(404, 'Source file is not registered.')
        path = ledger.local_source_file(source) if hasattr(ledger, 'local_source_file') else Path(source.local_path) if source.local_path else None
        if path is None:
            raise HTTPException(404, 'The original source file is unavailable on this backend. Its stored quotations and locators remain available.')
        if not path.is_file():
            raise HTTPException(404, 'Registered source file is unavailable.')
        if hashlib.sha256(path.read_bytes()).hexdigest() != source.sha256:
            raise HTTPException(409, 'Source bytes changed; the recorded evidence version cannot be displayed.')
        media_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
        # Active document formats are downloaded rather than executed in this origin.
        disposition = 'inline' if media_type in {'application/pdf','image/png','image/jpeg','application/json','text/plain'} else 'attachment'
        return FileResponse(path, media_type=media_type, filename=source.original_filename or path.name, content_disposition_type=disposition, headers={'X-Content-Type-Options':'nosniff'})

    @app.get('/deals/{deal_id}/observations')
    @app.get('/deals/{deal_id}/claims')
    def observations(deal_id: str, provider: str | None = None, metric: str | None = None):
        company(deal_id)
        return ledger.observations(deal_id, provider, metric)

    @app.post('/deals/{deal_id}/claims/batch')
    def ingest_partner_claims(deal_id: str, request: ClaimsBatchRequest):
        selected = company(deal_id)
        if not hasattr(ledger, 'ingest'):
            raise HTTPException(501, 'New source intake is pending the teammate integration; existing stored evidence remains available.')
        try:
            intake = ingest_b_claims(selected, request.claims, ledger.snapshots(deal_id))
            return {**ledger.ingest(intake), 'observations': intake.observations, 'warnings': intake.warnings}
        except ValueError as error:
            raise HTTPException(422, str(error)) from None

    @app.get('/deals/{deal_id}/report')
    def company_report(deal_id: str):
        selected = company(deal_id)
        try:
            rows = ledger.observations(deal_id)
            report = build_company_report(selected, ledger.profiles(deal_id), rows, ledger.snapshots(deal_id), ledger.calculations(deal_id), ledger.comparisons(deal_id))
            report['data_period_coverage'] = build_period_coverage(rows)
            report['source_graph'] = lineage(deal_id)
            source_conflicts = detect_conflicts(rows, ledger.snapshots(deal_id))
            report['conflicts'] = source_conflicts
            report['conflict_numbers'] = any(c.get('kind') in {'value_conflict', 'aggregate_value_conflict'} for c in source_conflicts)
            by_id = {c.id: c for c in ledger.calculations(deal_id)}
            for entry in report['calculations']:
                flags = annotate_calculation_conflicts(by_id[entry['calculation']['id']], rows, ledger.snapshots(deal_id))
                entry.update(flags)
                for node in entry['nodes']:
                    if node.get('data', {}).get('kind') == 'calculation':
                        node['data']['conflict_numbers'] = flags['conflict_numbers']
                report['conflict_numbers'] = report['conflict_numbers'] or flags['conflict_numbers']
            for entry in report['comparisons']:
                entry['conflict_numbers'] = entry['comparison']['status'] == 'value_mismatch'
                report['conflict_numbers'] = report['conflict_numbers'] or entry['conflict_numbers']
            report['flags'] = ['conflict numbers'] if report['conflict_numbers'] else []
            saved_reports = ledger.narrative_reports(deal_id) if hasattr(ledger, 'narrative_reports') else []
            claims = ledger.document_claims(deal_id) if hasattr(ledger, 'document_claims') else []
            claims = claims + stored_source_claims(selected, saved_reports, ledger.snapshots(deal_id))
            add_document_claims(report, claims)
            report['narrative_evidence'] = build_evidence_catalog(report)
            report['stored_reports'] = stored_report_summaries(saved_reports)
            if getattr(ledger, 'backend', None) == 'firestore':
                report['persistence'] = {'provider': 'firestore', 'project_id': ledger.project, 'database_id': ledger.database}
            # A teammate's registered file path is not proof that its bytes exist here.
            available = {s.id: bool(ledger.local_source_file(s)) if hasattr(ledger, 'local_source_file') else bool(s.local_path and Path(s.local_path).is_file()) for s in ledger.snapshots(deal_id)}
            def availability(value):
                if isinstance(value, dict):
                    if value.get('snapshot_id') in available and 'preview_url' in value:
                        value['preview_available'] = available[value['snapshot_id']]
                    for child in value.values(): availability(child)
                elif isinstance(value, list):
                    for child in value: availability(child)
            availability(report)
            return report
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.get('/deals/{deal_id}/stored-reports/{report_id}/draft')
    def load_stored_report(deal_id: str, report_id: str):
        report = company_report(deal_id)
        stored = next((r for r in ledger.narrative_reports(deal_id) if r['id'] == report_id), None) if hasattr(ledger, 'narrative_reports') else None
        if stored is None:
            raise HTTPException(404, 'Stored report not found in this company.')
        try:
            return stored_draft(stored, report)
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.post('/deals/{deal_id}/report/draft')
    def narrative_draft(deal_id: str, request: NarrativeDraftRequest):
        report = company_report(deal_id)
        if request.based_on_report_id != report['report_id']:
            raise HTTPException(409, {'code': 'stale_report', 'message': 'The company evidence changed. Refresh the stored report before generating a draft.'})
        try:
            engine = narrative_factory() if narrative_factory else NarrativeGenerator(AgentSettings.from_environment())
            return engine.generate(deal_id, request, report['narrative_evidence'])
        except NarrativeError as error:
            raise HTTPException(error.status_code, {'code': error.code, 'message': error.message}) from None

    @app.post('/deals/{deal_id}/chat')
    def company_chat(deal_id: str, request: CompanyChatRequest):
        report = company_report(deal_id)
        if request.report_id != report['report_id']:
            raise HTTPException(409, {'code': 'stale_report', 'message': 'The company evidence changed. Refresh the stored report before asking again.'})
        # Full stored records, without repeated display graphs or machine-local paths.
        sources = [s.model_dump(mode='json', exclude={'local_path'}) for s in ledger.snapshots(deal_id)]
        for source in sources:
            if source['source_uri'].startswith('file:'):
                source['source_uri'] = 'local-file://' + (source['original_filename'] or source['id'])
        context = {'company': report['company'], 'source_snapshots': sources,
                   'profiles': ledger.profiles(deal_id),
                   'observations': [o.model_dump(mode='json') for o in ledger.observations(deal_id)],
                   'calculations': [c.model_dump(mode='json') for c in ledger.calculations(deal_id)],
                   'comparisons': [c.model_dump(mode='json') for c in ledger.comparisons(deal_id)],
                   'document_claims': report['document_claims'], 'conflicts': report['conflicts'],
                   'stored_narrative_reports': ledger.narrative_reports(deal_id) if hasattr(ledger, 'narrative_reports') else [],
                   'period_coverage': report['data_period_coverage'], 'gaps': report['gaps']}
        try:
            engine = chat_factory() if chat_factory else CompanyChat(AgentSettings.from_environment())
            return engine.answer(deal_id, request, report['narrative_evidence'], context)
        except NarrativeError as error:
            raise HTTPException(error.status_code, {'code': error.code, 'message': error.message}) from None

    @app.get('/claims/{claim_id}/evidence')
    def evidence(claim_id: str):
        record = ledger.observation(claim_id)
        if not record:
            raise HTTPException(404, 'Observation not found.')
        snapshot = next(s for s in ledger.snapshots(record.deal_id) if s.id == record.snapshot_id)
        return {'observation_id': record.id, 'locator': record.locator, 'snapshot': snapshot, 'verification_status': record.verification_status}

    @app.post('/deals/{deal_id}/compare')
    def compare(deal_id: str, request: CompareRequest):
        c = company(deal_id)
        lhs, rhs = observation(deal_id, request.lhs_id), observation(deal_id, request.rhs_id)
        if lhs.id == rhs.id:
            raise HTTPException(422, 'Select two different source observations.')
        result = compare_observations(lhs, rhs, request.tolerance, c.historical_cutoff if request.historical_view else None)
        ledger.save_comparison(result)
        return {**result.model_dump(mode='json'), 'conflict_numbers': result.status == 'value_mismatch'}

    @app.get('/deals/{deal_id}/comparisons')
    def comparisons(deal_id: str):
        company(deal_id)
        return ledger.comparisons(deal_id)

    @app.post('/deals/{deal_id}/calculate/agent')
    def agent_calculation(deal_id: str, request: AgentCalculationRequest):
        company(deal_id)
        try:
            engine = agent_factory() if agent_factory else AgentCalculator(AgentSettings.from_environment())
            result = engine.calculate(deal_id, request, ledger.observations(deal_id), ledger.snapshots(deal_id), text_evidence=available_text_evidence(deal_id))
            if result.deal_id != deal_id:
                raise ValueError('Generated calculation belongs to another company.')
            ledger.save_calculation(result)
            return calculation_payload(result)
        except AgentCalculationError as error:
            raise HTTPException(error.status_code, {'code': error.code, 'message': error.message}) from None
        except ValueError:
            raise HTTPException(422, {'code': 'invalid_calculation', 'message': 'The calculation could not be stored with valid source references.'}) from None

    @app.post('/deals/{deal_id}/calculate', deprecated=True)
    def calculation(deal_id: str, request: CalculateRequest):
        company(deal_id)
        if len(request.input_ids) != len(set(request.input_ids)):
            raise HTTPException(422, 'Duplicate calculation input IDs are not allowed.')
        inputs = [observation(deal_id, record_id) for record_id in request.input_ids]
        result = calculate(request.metric_key, inputs, request.parameters, deal_id)
        ledger.save_calculation(result)
        return calculation_payload(result)

    @app.post('/deals/{deal_id}/calculate/revenue-dynamic', deprecated=True)
    def dynamic_revenue(deal_id: str, request: DynamicRevenueRequest):
        company(deal_id)
        if len(request.input_ids) != len(set(request.input_ids)):
            raise HTTPException(422, 'Duplicate calculation input IDs are not allowed.')
        if request.input_ids:
            inputs = [observation(deal_id, record_id) for record_id in request.input_ids]
        else:
            inputs = [row for row in ledger.observations(deal_id) if row.definition_key == 'recognized_revenue']
        result = calculate_revenue_dynamic(inputs, deal_id, request.target_start, request.target_end)
        ledger.save_calculation(result)
        return calculation_payload(result)

    @app.get('/deals/{deal_id}/calculations')
    def calculations(deal_id: str):
        company(deal_id)
        return [calculation_payload(result) for result in ledger.calculations(deal_id)]

    @app.post('/deals/{deal_id}/replay/balance-sheet', deprecated=True)
    def replay_assets(deal_id: str, request: ReplayRequest):
        company(deal_id)
        inputs = ledger.observations(deal_id, provider='orbis')
        if request.snapshot_id:
            source = ledger.snapshot(request.snapshot_id)
            if source is None or source.deal_id != deal_id or source.provider != 'orbis':
                raise HTTPException(404, 'Orbis source snapshot not found in this deal.')
            inputs = [o for o in inputs if o.snapshot_id == request.snapshot_id]
        result = replay_balance_sheet(inputs, deal_id, request.period_end)
        ledger.save_calculation(result)
        return calculation_payload(result)

    @app.get('/calculations/{calculation_id}/lineage')
    def calculation_lineage(calculation_id: str):
        result = ledger.calculation(calculation_id)
        if not result:
            raise HTTPException(404, 'Calculation not found.')
        inputs = [ledger.observation(i) for i in result.input_ids]
        try:
            graph = build_calculation_lineage(result, inputs, ledger.snapshots(result.deal_id))
            flags = annotate_calculation_conflicts(result, ledger.observations(result.deal_id), ledger.snapshots(result.deal_id))
            graph.update(flags)
            for node in graph['nodes']:
                if node.get('data', {}).get('kind') == 'calculation':
                    node['data']['conflict_numbers'] = flags['conflict_numbers']
            return graph
        except ValueError as error:
            raise HTTPException(409, str(error)) from None

    @app.get('/deals/{deal_id}/overview')
    def overview(deal_id: str):
        c = company(deal_id)
        rows = ledger.observations(deal_id)
        snapshots = ledger.snapshots(deal_id)
        return {'company': c, 'primary_source': 'akta', 'primary_profile_available': bool(ledger.profiles(deal_id)), 'observation_count': len(rows), 'data_channels': {channel: sum(s.ingestion_channel == channel for s in snapshots) for channel in ['provider_api','user_upload']}, 'providers': {provider: {'snapshots': sum(s.provider == provider for s in snapshots), 'observations': sum(o.provider == provider for o in rows)} for provider in ['orbis', 'pitchbook', 'akta', 'uploaded']}, 'needs_review': sum(not o.definition_key or o.quarantined or o.normalization_status != 'confirmed' for o in rows), 'warnings': ['Akta is the primary company profile; user-uploaded documents are supplemental private evidence.', 'Source observations retain provider definitions; reviewed equivalence is required for numeric comparisons.', 'Akta financial estimates do not substitute for financial statements or customer ledgers.']}

    @app.get('/deals/{deal_id}/lineage')
    def lineage(deal_id: str):
        company(deal_id)
        snapshots, rows, runs = ledger.snapshots(deal_id), ledger.observations(deal_id), ledger.calculations(deal_id)
        numeric_flags = {c.id: annotate_calculation_conflicts(c, rows, snapshots)['conflict_numbers'] for c in runs}
        nodes = ([{'id': s.id, 'type': 'source', 'data': {'label': s.original_filename or (Path(s.local_path).name if s.local_path else s.source_uri), 'provider': s.provider, 'sha256': s.sha256, 'ingestion_channel': s.ingestion_channel, 'data_role': s.data_role, 'preview_url': f'/sources/{s.id}/file'}} for s in snapshots]
                 + [{'id': o.id, 'type': 'observation', 'data': {'label': o.metric_key, 'value': str(o.value) if o.value is not None else None, 'unit': o.unit, 'raw_value': o.raw_value, 'locator': o.locator}} for o in rows]
                 + [{'id': c.id, 'type': 'calculation', 'data': {'label': c.metric_key, 'value': str(c.value) if c.value is not None else None, 'unit': c.unit, 'formula': c.formula, 'status': c.status, 'conflict_numbers': numeric_flags[c.id]}} for c in runs])
        edges = ([{'id': f'{o.snapshot_id}:{o.id}', 'source': o.snapshot_id, 'target': o.id, 'type': 'extracted_from'} for o in rows]
                 + [{'id': f'{i}:{c.id}', 'source': i, 'target': c.id, 'type': 'calculation_input'} for c in runs for i in c.input_ids])
        text_seen = set()
        text_file_edges = set()
        for run in runs:
            if run.function_key != 'llm_local_python':
                continue
            execution = run.parameters.get('agent_execution', {})
            cited_ids = {premise['evidence_id'] for premise in execution.get('premises', [])}
            for statement in execution.get('supplied_text_evidence', []):
                key = statement['id']
                if key not in text_seen:
                    nodes.append({'id': key, 'type': 'text_evidence', 'data': {'kind': 'text_evidence', 'label': 'Source text', 'text': statement['text'], 'source': statement['source']}})
                    text_seen.add(key)
                source_id = statement['source']['snapshot_id']
                if (source_id, key) not in text_file_edges:
                    edges.append({'id': f'{source_id}:{key}', 'source': source_id, 'target': key, 'type': 'source_text'})
                    text_file_edges.add((source_id, key))
                edges.append({'id': f'{key}:{run.id}', 'source': key, 'target': run.id,
                              'type': 'cited_premise' if key in cited_ids else 'supplied_context'})
        return {'nodes': nodes, 'edges': edges}

    return app


app = create_app()
