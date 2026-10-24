import { MODULES, EVIDENCE, DEFAULT_MODULES, evidenceForModule } from './data.ts'
import type { Evidence, ModuleId } from './data.ts'
import type { CompanyReport, BackendEvidence } from './backend'

export type Project = { id: string; name: string; sector: string; geography: string; created: string }
export type ModuleConfig = { topics: string[]; depth: 'Brief' | 'Standard' | 'Deep'; geography: string; horizon: string; scope: 'Internal only' | 'Internal + external'; focus: string }
export type Section = { id: ModuleId; title: string; content: string; evidenceIds: string[]; config: ModuleConfig }
export type Revision = { id: string; at: string; section: ModuleId; title: string; before: string; after: string; author: string }
export type Workspace = { order: ModuleId[]; configs: Partial<Record<ModuleId, ModuleConfig>>; sections: Section[]; revisions: Revision[]; generatedAt: string | null; backendReportId?: string; backendReportVersion?: string }
export type LocalDocument = { id: string; projectId: string; name: string; type: string; size: number; category: string; added: string; url?: string }

export const ENFUCE: Project = { id: 'enfuce', name: 'Enfuce', sector: 'Fintech', geography: 'Finland', created: '2026-10-24T12:00:00Z' }
export function defaultConfig(id: ModuleId): ModuleConfig {
  const module = MODULES.find(m => m.id === id)!
  return { topics: module.topics.slice(0, id === 'market' ? 5 : 3), depth: 'Standard', geography: id === 'market' ? 'Europe' : 'Global', horizon: 'Source period', scope: 'Internal only', focus: '' }
}
export function defaultBackendConfig(id: ModuleId): ModuleConfig {
  const config = defaultConfig(id)
  return id === 'financials' ? { ...config, topics: [...MODULES.find(module => module.id === id)!.topics, 'Other financial records'] } : config
}
export function emptyWorkspace(): Workspace {
  return { order: [...DEFAULT_MODULES], configs: {}, sections: [], revisions: [], generatedAt: null }
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return [...items]
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

const PARAGRAPHS: Record<string, string> = {
  company: 'The historical FDD describes Enfuce as a financial technology company founded in 2016 and headquartered in Finland, with payment services as its primary business. This is the source’s description, not a current independently verified profile. [company]',
  income: 'H1 2020 group operating income totals €3,452,682.81: €3,417,663.76 in revenue plus €35,019.05 in other operating income. The saved worksheet values reproduce this arithmetic. [income]',
  definition: 'The summary’s “营业收入” figure corresponds numerically to total operating income, rather than pure revenue. Confirm the report’s revenue definition before making a direct comparison. [definition]',
  gross: 'The 2019 gross profit formula reproduces 3,609.32824 kEUR: 5,095.50635 − 1,536.17811 + 50. The additional 50 kEUR is an unlabeled constant; its business meaning needs clarification. [gross]',
  mrr: 'The MRR worksheet’s Q-column total is €366,559.95, displayed as 367 kEUR after the source number format is applied. ARR is not calculated: the recurring revenue definition, customer scope and as-of date need confirmation. [mrr]',
  rounding: 'Reported 2019 revenue of 5,096 kEUR is numerically consistent with the workbook’s 5,095.50635 kEUR after rounding. Entity scope remains unresolved, so this is not a final matched comparison. [rounding]',
  customers: 'The historical FDD reports 16 customers and identifies ST1 as the largest. No customer-level reconciliation is available in this snapshot; treat both statements as reported only. [customers]',
}

export function generateSections(project: Project, workspace: Workspace): Section[] {
  return workspace.order.map(id => {
    const module = MODULES.find(m => m.id === id)!
    const config = workspace.configs[id] ?? defaultConfig(id)
    let ids = project.id === 'enfuce' ? [...evidenceForModule(id)] : []
    if (id === 'financials') {
      ids = ids.filter(key => (['income', 'definition', 'rounding'].includes(key) && config.topics.includes('Revenue')) || (key === 'gross' && config.topics.includes('Gross profit')) || (key === 'mrr' && config.topics.includes('Recurring revenue')))
    }
    if (id === 'overview' && !config.topics.includes('Company profile')) ids = []
    if (id === 'customers' && !config.topics.includes('Customer base')) ids = []
    if (config.topics.length === 0) ids = []
    let content = ''
    if (id === 'questions' && ids.length > 0) {
      content = ids.map(key => `${EVIDENCE.find(e => e.id === key)!.note} [${key}]`).join('\n\n')
    } else {
      content = ids.map(key => PARAGRAPHS[key]).filter(Boolean).join('\n\n')
    }
    if (!content) content = `No supporting evidence is available in this project snapshot for ${module.name.toLowerCase()}. Requested topics: ${config.topics.join(', ') || 'none selected'}. Add source material and complete extraction before drafting factual claims.`
    if (id === 'financials' && config.topics.includes('Cash & runway')) content += '\n\nCash and runway: no supporting inputs are available; these metrics cannot be calculated.'
    content += `\n\nRequested scope: ${config.depth.toLowerCase()} · ${config.geography} · ${config.horizon}.`
    if (config.focus.trim()) content += `\n\nResearch focus: ${config.focus.trim()}\nThis focus has been saved for retrieval; this local preview does not perform additional research.`
    if (config.scope === 'Internal + external') content += '\n\nExternal evidence requested. No external search has been executed in this local preview.'
    return { id, title: module.name, content, evidenceIds: ids, config: structuredClone(config) }
  })
}

export function generateBackendSections(project: Project, workspace: Workspace, report: CompanyReport, evidence: BackendEvidence[]): Section[] {
  if (project.id !== 'circle' || report.company.deal_id !== 'circle-2025-ipo') throw new Error('Backend report does not belong to this project.')
  const financial = evidence.filter(item => item.kind !== 'profile')
  const topicFor = (item: BackendEvidence): string => {
    const key = item.metricKey ?? ''
    if (['revenue', 'recognized_revenue', 'orbis.sales', 'orbis.operating_revenue', 'orbis.export_revenue', 'pitchbook.total_revenue'].includes(key)) return 'Revenue'
    if (['gross_profit', 'cost_of_goods_sold', 'orbis.gross_profit', 'orbis.costs_of_goods_sold', 'pitchbook.gross_profit'].includes(key)) return 'Gross profit'
    if (['arr', 'mrr', 'recurring_revenue', 'monthly_recurring_revenue', 'annual_recurring_revenue'].includes(key)) return 'Recurring revenue'
    if (['monthly_net_burn', 'runway', 'cash_balance', 'cash_and_cash_equivalents', 'orbis.cash_and_cash_equivalents', 'pitchbook.cash_flow_operating_indirect', 'pitchbook.change_in_cash'].includes(key)) return 'Cash & runway'
    return 'Other financial records'
  }
  const overviewPaths = new Set(['/firmographic/legal_name', '/firmographic/company_description_short', '/firmographic/founded_year', '/firmographic/headcount_range', '/firmographic/company_type/label', '/firmographic/ownership_category/label', '/firmographic/ticker', '/firmographic/website', '/industry/product_category', '/location/hq/city', '/location/hq/country'])
  const profile = evidence.filter(item => item.kind === 'profile' && overviewPaths.has(item.rows.find(([name]) => name === 'Field')?.[1] ?? ''))
  const review = evidence.filter(item => item.conflictNumbers || item.status === 'Needs review')
  const reviewPreview = [...review].sort((a, b) => Number(b.conflictNumbers) - Number(a.conflictNumbers)).slice(0, 12)
  return workspace.order.map(id => {
    const module = MODULES.find(item => item.id === id)!
    const config = workspace.configs[id] ?? defaultBackendConfig(id)
    const records = config.topics.length === 0 ? [] : id === 'overview' && config.topics.includes('Company profile') ? profile : id === 'financials' ? financial.filter(item => config.topics.includes(topicFor(item))) : id === 'questions' ? reviewPreview : []
    const paragraphs = records.map(item => {
      let line = `${item.title}: ${item.value}. Source period: ${item.period}; unit: ${item.unit}. [${item.id}]`
      if (item.kind === 'observation' && item.rawValue != null) line += `\nRecorded source token: ${item.rawValue}. This is retained separately from the normalized value.`
      if (item.formula) line += `\nStored formula: ${item.formula}.`
      if (item.kind === 'calculation') {
        line += `\n${item.rows.map(([name, value]) => `${name}: ${value}`).join('\n')}`
        if (item.calculation) line += `\nFunction: ${item.calculation.function_key} v${item.calculation.function_version}; status: ${item.calculation.status}.`
        if (item.inputIds?.length) line += `\nInput observation IDs: ${item.inputIds.join(', ')}.`
      }
      if (item.conflictNumbers) line += '\nConflict numbers: the backend flagged differing comparable values. Original values remain available in the source evidence.'
      if (item.kind === 'profile' || item.status === 'Needs review' || id === 'questions') line += `\n${item.note}`
      return line
    })
    if (id === 'financials' && config.topics.length) {
      paragraphs.unshift('Available financial records and stored calculations for the selected topics. Topic grouping uses exact provider metric labels for display; it does not establish reviewed definition equivalence. Values retain their source periods and definitions; no financial arithmetic or annualization is performed in this report.')
      if (!records.length) paragraphs.push('No stored financial records are available for the selected topics.')
      for (const gap of report.gaps) paragraphs.push(`Evidence gap: ${String(gap.message ?? gap.code ?? 'Details unavailable')}`)
    }
    if (id === 'questions' && config.topics.length) {
      for (const gap of report.gaps) paragraphs.unshift(`Evidence gap: ${String(gap.message ?? gap.code ?? 'Details unavailable')}`)
      if (report.conflict_numbers) paragraphs.unshift('Conflict numbers: comparable disagreements are flagged in the backend report. Review their original values and sources; the report does not choose an authoritative value.')
      if (review.length > reviewPreview.length) paragraphs.push(`Showing ${reviewPreview.length} source review prompts. All ${review.length} flagged records remain available in the dashboard and financial evidence.`)
      paragraphs.push('New file uploads and Akta retrieval are pending the extraction teammate’s integration. This report uses evidence already stored in the backend.')
    }
    if (!records.length && id !== 'financials' && id !== 'questions') paragraphs.push(`No supporting evidence is available for ${module.name.toLowerCase()} in the loaded backend report. Requested topics: ${config.topics.join(', ') || 'none selected'}.`)
    if ((id === 'financials' || id === 'questions') && !config.topics.length) paragraphs.push('No topics selected for this section.')
    paragraphs.push(`Requested drafting scope: ${config.depth.toLowerCase()} · ${config.geography} · ${config.horizon}. Topic choices select displayed records; depth, geography and horizon remain drafting preferences and do not change backend values or source periods.`)
    if (config.focus.trim()) paragraphs.push(`Research focus: ${config.focus.trim()}\nSaved as a drafting preference; no additional retrieval has been performed.`)
    if (config.scope === 'Internal + external') paragraphs.push('External evidence requested. No external search has been executed by this report builder.')
    return { id, title: module.name, content: paragraphs.join('\n\n'), evidenceIds: records.map(item => item.id), config: structuredClone(config) }
  })
}

export function citedEvidenceIds(sections: Section[], evidence: Evidence[] = EVIDENCE): string[] {
  const allowed = new Set(evidence.map(item => item.id))
  return [...new Set(sections.flatMap(section => [...section.content.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1])).filter(id => allowed.has(id)))]
}

export function backendDraftEvidenceStatus(sections: Section[], draftReportId: string | undefined, loadedReportId: string, evidence: Evidence[]) {
  const allowed = new Set(evidence.map(item => item.id))
  const backendUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const missingIds = [...new Set(sections.flatMap(section => {
    const declared = new Set(section.evidenceIds)
    return [...section.content.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1]).filter(id => !allowed.has(id) && (declared.has(id) || backendUuid.test(id) || id.startsWith('field:')))
  }))]
  const stale = !draftReportId || draftReportId !== loadedReportId
  return { stale, missingIds, blocked: stale || missingIds.length > 0 }
}

export type ReportExportContext = { kind: 'backend' | 'snapshot'; reportId?: string; loadedReportId?: string; reportVersion?: string }

export function reportMarkdown(project: Project, sections: Section[], evidence: Evidence[] = EVIDENCE, context: ReportExportContext = { kind: 'snapshot' }): string {
  if (context.kind === 'backend') {
    if (!context.loadedReportId || !context.reportId || context.reportId !== context.loadedReportId) throw new Error('Backend evidence has changed. Regenerate the draft before exporting.')
    if (backendDraftEvidenceStatus(sections, context.reportId, context.loadedReportId, evidence).missingIds.length) throw new Error('Some source citations are unavailable in the loaded backend report. Regenerate the draft before exporting.')
  }
  const sources = citedEvidenceIds(sections, evidence).map(id => {
    const e = evidence.find(item => item.id === id)!
    let reference = `- [${id}] ${e.title}: ${e.value}; ${e.file} — ${e.locator}; period: ${e.period}; unit: ${e.unit}; status: ${e.status}. ${e.note}`
    if (e.formula) reference += `\n  Stored formula: ${e.formula}`
    if (e.hash) reference += `\n  SHA-256: ${e.hash}`
    for (const [name, value] of e.rows) reference += `\n  ${name}: ${value}`
    if ('sources' in e && Array.isArray(e.sources)) {
      const traceable = e as BackendEvidence
      if (traceable.calculation) reference += `\n  Calculation ID: ${traceable.id}; function: ${traceable.calculation.function_key} v${traceable.calculation.function_version}; status: ${traceable.calculation.status}; parameters: ${JSON.stringify(traceable.calculation.parameters)}`
      if (traceable.inputIds?.length) reference += `\n  Input observation IDs: ${traceable.inputIds.join(', ')}`
      for (const source of traceable.sources) reference += `\n  Original source: ${source.file_name}; snapshot: ${source.snapshot_id}; locator: ${source.locator ? JSON.stringify(source.locator) : 'Unknown'}; SHA-256: ${source.sha256 ?? 'Unknown'}`
    }
    return reference
  }).join('\n')
  const basis = context.kind === 'backend'
    ? `Backend evidence report. Report ID: ${context.reportId ?? 'Unknown'}; version: ${context.reportVersion ?? 'Unknown'}. Values and stored calculations retain their original source periods. Upload processing and Akta retrieval are pending. User edits have not been reverified.`
    : 'Local evidence preview. Historical saved extracts; not live research or an investment recommendation. User edits have not been reverified.'
  return `# ${project.name} — Diligence report\n\n${basis}\n\n${sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n')}\n\n## Evidence references\n\n${sources || 'No cited evidence.'}\n`
}

export function safeUrl(input: string): string | null {
  try { const url = new URL(input); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}

export function readLocal<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
export function saveLocal(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

let dbPromise: Promise<IDBDatabase> | null = null
function openFileDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('acefire-files', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { dbPromise = null; reject(request.error) }
  })
  return dbPromise
}
export async function saveBlob(id: string, blob: Blob): Promise<void> {
  const db = await openFileDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    transaction.objectStore('files').put(blob, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
export async function readBlob(id: string): Promise<Blob | undefined> {
  const db = await openFileDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
