import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ConnectedDashboard from '../../src/ConnectedDashboard'
import type { CompanyReport } from '../../src/backend'
import type { Project } from '../../src/domain'
import '../../src/styles.css'
import '../../src/motion.css'
import '../../src/connection.css'

const source = { snapshot_id:'original-file', file_name:'revenue.csv', sha256:'a'.repeat(64), provider:'uploaded', ingestion_channel:'user_upload', data_role:'supplemental_evidence', visibility:'deal_private', preview_url:'/sources/original-file/file', locator:{ kind:'csv_row', row:2, column:'Amount', quote:'Revenue,100.123400000000000006' } }
const original = { id:'raw-revenue', deal_id:'fixture-company', entity_key:'fixture-company', snapshot_id:source.snapshot_id, provider:'uploaded', metric_key:'uploaded.amount', raw_label:'Revenue', raw_value:'100.123400000000000006', value:null, unit:null, currency:null, scale_multiplier:null, normalization_status:'unresolved', normalization_basis:null, definition_key:null, scope:null, accounting_basis:null, period_kind:'unknown', period_start:null, period_end:null, period_label:null, scenario:'unknown', verification_status:'source_located', locator:source.locator, quarantined:false, notes:[] }
const initial = { report_id:'evidence-v1', report_version:'1', generated_at_utc:'2026-10-26T12:00:00Z', company:{ deal_id:'fixture-company', entity_key:'fixture-company', legal_name:'Numeric fixture', primary_provider:'akta', country:'Unknown', domain:'', historical_cutoff:null, identifiers:{} },
  primary_profile:{ available:false, provider:'akta', records:[], field_lineage:{ fields:[], sources:[], nodes:[], edges:[] } }, reported_metrics:[{ observation:original, source, context:{ review_required:true, review_reasons:['normalized_value_unavailable'] } }], calculations:[], comparisons:[], source_files:[source], document_claims:[], data_period_coverage:[], source_graph:{ nodes:[], edges:[] }, conflicts:[], conflict_numbers:false, flags:[], gaps:[], coverage:[], summary:{} } as unknown as CompanyReport
const project: Project = { id:'fixture-company', name:'Numeric fixture', sector:'Fintech', geography:'Unknown', created:'2026-10-26T12:00:00Z', backendDealId:'fixture-company' }
function Fixture() {
  const [report, setReport] = useState(initial), [refreshes, setRefreshes] = useState(0), [calculations, setCalculations] = useState(0), [route, setRoute] = useState('')
  const [visible, setVisible] = useState(true)
  useEffect(() => { Object.assign(window, { normalizationFixture:{ report, refreshes, calculations, setReport } }) }, [report, refreshes, calculations])
  return <main style={{ padding:24 }}><button onClick={() => setVisible(value => !value)}>{visible ? 'Leave calculation page' : 'Return to calculation page'}</button><output aria-label="Review refreshes">{refreshes}</output><output aria-label="Completed calculations">{calculations}</output><output aria-label="Fixture route">{route}</output>{visible && <ConnectedDashboard project={project} report={report} inspect={() => {}} navigate={setRoute} onCalculated={() => setCalculations(value => value+1)} onRefresh={() => setRefreshes(value => value+1)} />}</main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
