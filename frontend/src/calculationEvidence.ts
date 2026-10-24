import type { CompanyReport, BackendSource } from './backend'
import { reportEvidence } from './backend.ts'

export type CalculationTextEvidence = { id: string; text: string; fieldPath: string; source: BackendSource }

/** Use the same canonical statement IDs and original quotations that the API accepts. */
export function calculationTextEvidence(report: CompanyReport): CalculationTextEvidence[] {
  const registered = new Map(report.source_files.map(source => [source.snapshot_id, source]))
  const candidates = report.narrative_evidence === undefined
    ? reportEvidence(report).filter(item => item.kind === 'profile' || item.kind === 'statement')
      .map(item => ({ id: item.id, text: item.citationText ?? item.excerpt, title: item.title, source: item.sources[0] }))
    : report.narrative_evidence.filter(item => item.kind === 'statement' && item.deal_id === report.company.deal_id)
  const seen = new Set<string>()
  return candidates.flatMap(item => {
    const source = item.source
    const original = source && registered.get(source.snapshot_id)
    if (seen.has(item.id) || !item.text.trim() || !source || !original || source.sha256 !== original.sha256 || source.provider !== original.provider) return []
    seen.add(item.id)
    return [{ id: item.id, text: item.text, fieldPath: item.title, source }]
  })
}
