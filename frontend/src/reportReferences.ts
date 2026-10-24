import type { BackendEvidence, BackendSource, CompanyReport } from './backend'
import { backendProjectId } from './backend.ts'
import type { Evidence } from './data'
import type { NarrativeCitation, Project, Section, Workspace } from './domain'

type SourceBinding = { snapshot_id: string; file_name: string; sha256: string; provider: string; locator: Record<string, unknown> | null }
type QuoteBinding = { sectionId: string; claimId: string; evidenceId: string; kind: string; quoteBasis: string; quote: string; sources: SourceBinding[] }
export type EvidenceReferenceCheck = {
  version: 1; dealId: string; basisReportId: string; checkedReportId: string; checkedAt: string;
  retainedIds: string[]; references: QuoteBinding[]; method: 'retained_original_quote_source_hash_locator_v1';
}
const canonical = (value: unknown): string => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))]))
  : value ?? null)
const sort = <T,>(values: T[]): T[] => [...values].sort((a, b) => canonical(a).localeCompare(canonical(b)))

export function retainedReferenceIds(sections: Section[], evidence: Evidence[]): string[] {
  const available = new Set(evidence.map(item => item.id))
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return [...new Set(sections.flatMap(section => {
    const declared = new Set(section.evidenceIds)
    return [...section.content.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1])
      .filter(id => available.has(id) || declared.has(id) || uuid.test(id) || id.startsWith('field:') || id.startsWith('claim:'))
  }))].sort()
}

function sourceBinding(source: BackendSource, dealId: string): SourceBinding {
  if (!source || typeof source.snapshot_id !== 'string' || !source.snapshot_id || typeof source.file_name !== 'string'
    || typeof source.provider !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)
    || source.deal_id !== undefined && source.deal_id !== dealId
    || source.locator != null && (typeof source.locator !== 'object' || Array.isArray(source.locator))) {
    throw new Error('A retained citation has an invalid or different-company source binding.')
  }
  return { snapshot_id: source.snapshot_id, file_name: source.file_name, sha256: source.sha256, provider: source.provider, locator: source.locator ?? null }
}

function quoteBinding(sectionId: string, claimId: string, citation: NarrativeCitation, current: BackendEvidence, dealId: string): QuoteBinding {
  const kind = current.kind === 'profile' ? 'statement' : current.kind
  const basis = current.quoteBasis ?? (kind === 'statement' ? 'source_text' : 'structured_record')
  const original = current.citationText ?? current.excerpt
  if (citation.kind !== kind || citation.quote_basis !== basis || typeof citation.quote !== 'string' || !citation.quote.trim() || !original.includes(citation.quote)) {
    throw new Error('A retained quotation no longer matches its current source record. The draft text has been kept.')
  }
  const supplied = citation.source ? [citation.source] : citation.sources ?? []
  if (citation.source && citation.sources?.length) throw new Error('A retained citation has ambiguous original source bindings.')
  if (!supplied.length || !Array.isArray(current.sources) || !current.sources.length) throw new Error('A retained citation has no recorded original source binding. Regenerate explicitly to obtain source support.')
  const oldSources = sort(supplied.map(source => sourceBinding(source, dealId)))
  const currentSources = sort(current.sources.map(source => sourceBinding(source, dealId)))
  if (canonical(oldSources) !== canonical(currentSources)) throw new Error('A retained source file, SHA-256 or locator has changed. The draft text has been kept.')
  return { sectionId, claimId, evidenceId: citation.evidence_id, kind, quoteBasis: basis, quote: citation.quote, sources: oldSources }
}

function bindingManifest(sections: Section[], evidence: Evidence[], dealId: string) {
  const records = new Map(evidence.map(item => [item.id, item]))
  const retainedIds = retainedReferenceIds(sections, evidence)
  if (retainedIds.some(id => !records.has(id))) throw new Error('Some retained source citations are unavailable. Remove or restore those references explicitly before refreshing them.')
  const references: QuoteBinding[] = []
  for (const section of sections) {
    const retained = retainedReferenceIds([section], evidence)
    for (const id of retained) {
      const original = records.get(id) as BackendEvidence
      const bindings = (section.sourceClaims ?? []).flatMap(claim => (claim.citations ?? [])
        .filter(citation => citation.evidence_id === id).map(citation => quoteBinding(section.id, claim.id, citation, original, dealId)))
      if (!bindings.length) throw new Error('This draft does not retain the original quote and source binding for every citation. Regenerate explicitly; no source match was inferred.')
      references.push(...bindings)
    }
  }
  return { retainedIds, references: sort(references) }
}

/** Checks recorded reference identity only. It does not rewrite or verify human prose. */
export function refreshReportSourceReferences(project: Project, workspace: Workspace, report: CompanyReport, evidence: BackendEvidence[], checkedAt = new Date().toISOString()): Workspace {
  const dealId = project.backendDealId ?? backendProjectId(project.id) ?? project.id
  if (dealId !== report.company.deal_id) throw new Error('This evidence belongs to a different company. Your draft has been kept.')
  if (!workspace.backendReportId || !workspace.sections.length) throw new Error('This draft has no recorded backend generation basis. Regenerate explicitly before refreshing its references.')
  if (workspace.sections.some(section => section.generation && workspace.backendDraftId && section.generation.draftId !== workspace.backendDraftId)) throw new Error('This draft contains mixed generation versions. Regenerate explicitly before refreshing its references.')
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('The reference check time is invalid.')
  const check: EvidenceReferenceCheck = { version: 1, dealId, basisReportId: workspace.backendReportId,
    checkedReportId: report.report_id, checkedAt, method: 'retained_original_quote_source_hash_locator_v1',
    ...bindingManifest(workspace.sections, evidence, dealId) }
  return { ...workspace, backendEvidenceCheckedReportId: report.report_id, backendEvidenceCheckedAt: checkedAt, backendEvidenceReferenceCheck: check }
}

export function checkedReferenceStatus(sections: Section[], basisReportId: string | undefined, loadedReportId: string, evidence: Evidence[], check: EvidenceReferenceCheck | undefined, dealId?: string): { valid: boolean; error?: string } {
  if (!check) return { valid: false }
  try {
    if (check.version !== 1 || check.method !== 'retained_original_quote_source_hash_locator_v1'
      || !dealId || check.dealId !== dealId || check.basisReportId !== basisReportId || check.checkedReportId !== loadedReportId
      || typeof check.checkedAt !== 'string' || !Number.isFinite(Date.parse(check.checkedAt))) throw new Error('The saved reference check belongs to a different company, draft basis or evidence version.')
    const current = bindingManifest(sections, evidence, dealId)
    if (canonical(current.retainedIds) !== canonical(check.retainedIds) || canonical(current.references) !== canonical(check.references)) throw new Error('Retained citations changed after the previous reference check. Refresh source references explicitly again.')
    return { valid: true }
  } catch (error) { return { valid: false, error: error instanceof Error ? error.message : 'Source references require a fresh check.' } }
}
