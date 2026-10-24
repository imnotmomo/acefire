import type { BackendSource, CompanyReport } from './backend'
import { backendProjectId, sourceFileUrl } from './backend.ts'

export type DocumentChatSource = { id: string; label: number; kind: string; excerpt: string; source: BackendSource }
export type DocumentChatReply = { status: 'answered' | 'insufficient_evidence'; answer: string; sources: DocumentChatSource[];
  statements: { text: string; source_ids: string[] }[]; gaps: string[];
  coverage: { registered_sources: number; indexed_chunks: number; retrieved_chunks: number; method?: string; source_gaps: { snapshot_id: string; reason: string }[] } }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
const count = (value: unknown, maximum = 1_000_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
const kinds = new Set(['raw', 'observation', 'document_claim', 'profile', 'calculation', 'comparison'])
const invalid = (): never => { throw new Error('The source-search response has invalid company evidence or citations. No factual answer was added; refresh the company sources before retrying.') }

/** Only explicit backend workspaces may call the source-search service. */
export function documentChatDeal(project: { id: string; backendDealId?: string }): string | null {
  return project.backendDealId || backendProjectId(project.id)
}

export const documentQuestionKey = (dealId: string) => `acefire:document-chat-pending:v1:${encodeURIComponent(dealId)}`
export function pendingDocumentQuestion(value: string | null): string {
  return value && value.trim().length > 0 && value.length <= 4000 ? value : ''
}

export function parseDocumentReply(payload: unknown, dealId: string, report?: CompanyReport): DocumentChatReply {
  if (report && report.company.deal_id !== dealId) return invalid()
  if (!object(payload) || !['answered', 'insufficient_evidence'].includes(String(payload.status)) || !text(payload.answer, 40_000)
    || payload.deal_id !== undefined && payload.deal_id !== dealId
    || !Array.isArray(payload.sources) || payload.sources.length > 24 || !Array.isArray(payload.statements) || payload.statements.length > 16
    || !Array.isArray(payload.gaps) || payload.gaps.length > 30 || !payload.gaps.every(gap => text(gap, 8000)) || !object(payload.coverage)) return invalid()
  const registered = report ? new Map(report.source_files.map(source => [source.snapshot_id, source])) : null
  const ids = new Set<string>()
  const sources = payload.sources.map((item, index): DocumentChatSource => {
    if (!object(item) || !text(item.id, 200) || ids.has(item.id) || item.label !== index + 1 || !kinds.has(String(item.kind))
      || !text(item.excerpt, 2400) || !object(item.source)) return invalid()
    ids.add(item.id)
    const source = item.source
    if (!text(source.snapshot_id, 200) || !text(source.file_name, 2000) || !text(source.sha256, 64) || !/^[a-f0-9]{64}$/i.test(source.sha256)
      || !['provider', 'ingestion_channel', 'data_role', 'visibility', 'preview_url'].every(key => text(source[key], 8000)) || !object(source.locator)) return invalid()
    try { sourceFileUrl(source.preview_url as string) } catch { return invalid() }
    if ((source.preview_url as string).startsWith('/') && source.preview_url !== `/sources/${encodeURIComponent(source.snapshot_id)}/file`) return invalid()
    const known = registered?.get(source.snapshot_id)
    if (registered && (!known || known.sha256 !== source.sha256 || known.file_name !== source.file_name || known.provider !== source.provider)) return invalid()
    return { id: item.id, label: index + 1, kind: String(item.kind), excerpt: item.excerpt,
      source: { snapshot_id: source.snapshot_id, file_name: source.file_name, sha256: source.sha256,
        provider: source.provider as string, ingestion_channel: source.ingestion_channel as string, data_role: source.data_role as string,
        visibility: source.visibility as string, preview_url: source.preview_url as string, locator: structuredClone(source.locator),
        ...(known?.preview_available === false || source.preview_available === false ? { preview_available: false } : {}),
      } }
  })
  const statements = payload.statements.map((statement): DocumentChatReply['statements'][number] => {
    if (!object(statement) || !text(statement.text, 2000) || /\p{Script=Han}/u.test(statement.text)
      || !Array.isArray(statement.source_ids) || statement.source_ids.length < 1 || statement.source_ids.length > 12
      || !statement.source_ids.every(id => typeof id === 'string' && ids.has(id))) return invalid()
    return { text: statement.text, source_ids: [...statement.source_ids] as string[] }
  })
  const used = new Set(statements.flatMap(statement => statement.source_ids))
  if (used.size !== ids.size || [...ids].some(id => !used.has(id))) return invalid()
  if (payload.status === 'answered') {
    if (!statements.length || !sources.length) return invalid()
    const labels = new Map(sources.map(source => [source.id, source.label]))
    const rendered = statements.map(statement => `${statement.text} ${statement.source_ids.map(id => `[${labels.get(id)}]`).join(' ')}`).join('\n\n')
    if (payload.answer !== rendered) return invalid()
  } else if (sources.length || statements.length) return invalid()
  const coverage = payload.coverage
  if (!count(coverage.registered_sources) || !count(coverage.indexed_chunks) || !count(coverage.retrieved_chunks, 24)
    || coverage.retrieved_chunks > coverage.indexed_chunks || !Array.isArray(coverage.source_gaps) || coverage.source_gaps.length > 10_000) return invalid()
  const source_gaps = coverage.source_gaps.map(gap => {
    if (!object(gap) || !text(gap.snapshot_id, 200) || !text(gap.reason, 8000) || registered && !registered.has(gap.snapshot_id)) return invalid()
    return { snapshot_id: gap.snapshot_id, reason: gap.reason }
  })
  return { status: payload.status as DocumentChatReply['status'], answer: payload.answer, statements, sources, gaps: [...payload.gaps] as string[],
    coverage: { registered_sources: coverage.registered_sources, indexed_chunks: coverage.indexed_chunks, retrieved_chunks: coverage.retrieved_chunks,
      source_gaps, ...(typeof coverage.method === 'string' ? { method: coverage.method.slice(0, 1000) } : {}) } }
}

export function documentChatError(status: number, payload?: unknown): string {
  if (status === 404) return 'This company is not registered in the backend. Refresh its sources before asking again.'
  if (status === 503) return 'The evidence model is unavailable. Check the backend model configuration, then retry your preserved question.'
  if (object(payload)) {
    const detail = payload.detail
    if (typeof detail === 'string' && detail.trim()) return `${detail.slice(0, 500)} Your question is preserved.`
    if (object(detail) && typeof detail.message === 'string' && detail.message.trim()) return `${detail.message.slice(0, 500)} Your question is preserved.`
  }
  return 'Source search could not produce a validated answer. Your question is preserved; you can retry.'
}
