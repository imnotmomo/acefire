import type { BackendSource, CompanyReport } from './backend'

export type SourceState = { state: 'missing' | 'verify'; readingViewEvidence: boolean; readingViews: BackendSource[]; originals: BackendSource[] }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)

/** Resolve reading representations only through registered IDs and recorded hashes. */
export function sourceStates(report: Pick<CompanyReport, 'company' | 'source_files' | 'document_claims'>): Map<string, SourceState> {
  const entries = report.source_files, counts = new Map<string, number>()
  for (const source of entries) counts.set(source.snapshot_id, (counts.get(source.snapshot_id) ?? 0) + 1)
  const registered = new Map(entries.filter(source => counts.get(source.snapshot_id) === 1
    && (!source.deal_id || source.deal_id === report.company.deal_id)
    && (!source.entity_key || source.entity_key === report.company.entity_key)).map(source => [source.snapshot_id, source]))
  const direct = new Set(entries.filter(source => source.has_reported_observations || source.has_profile_fields).map(source => source.snapshot_id))
  const views = new Map<string, Set<string>>(), originals = new Map<string, Set<string>>()
  function bind(readingId: string, originalId: string, expectedHash?: unknown) {
    const reading = registered.get(readingId), original = registered.get(originalId)
    if (!reading || !original || !hash(reading.sha256) || !hash(original.sha256) || readingId === originalId || !/\.pdf$/i.test(reading.file_name)
      || expectedHash !== undefined && expectedHash !== original.sha256) return
    const context = record(reading.context)
    if (context.original_snapshot_id === originalId && context.original_sha256 !== undefined && context.original_sha256 !== original.sha256) return
    if (!views.has(originalId)) views.set(originalId, new Set())
    if (!originals.has(readingId)) originals.set(readingId, new Set())
    views.get(originalId)!.add(readingId); originals.get(readingId)!.add(originalId)
  }
  for (const reading of registered.values()) {
    const context = record(reading.context)
    if (typeof context.original_snapshot_id === 'string' && hash(context.original_sha256)) bind(reading.snapshot_id, context.original_snapshot_id, context.original_sha256)
  }
  for (const claim of report.document_claims ?? []) {
    if (claim.deal_id !== report.company.deal_id || claim.entity_key !== report.company.entity_key || !registered.has(claim.snapshot_id)) continue
    direct.add(claim.snapshot_id)
    for (const evidence of claim.evidence) {
      if (!registered.has(evidence.snapshot_id) || !evidence.quote.trim()) continue
      direct.add(evidence.snapshot_id)
      if (typeof evidence.original_snapshot_id === 'string') bind(evidence.snapshot_id, evidence.original_snapshot_id)
    }
  }
  return new Map(entries.map(source => {
    const readingViews = [...(views.get(source.snapshot_id) ?? [])].map(id => registered.get(id)!)
    const readingViewEvidence = !direct.has(source.snapshot_id) && readingViews.some(reading => direct.has(reading.snapshot_id))
    return [source.snapshot_id, { state: direct.has(source.snapshot_id) || readingViewEvidence ? 'verify' : 'missing', readingViewEvidence, readingViews,
      originals: [...(originals.get(source.snapshot_id) ?? [])].map(id => registered.get(id)!) }]
  }))
}
