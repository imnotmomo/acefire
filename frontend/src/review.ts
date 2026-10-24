import type { Evidence } from './data.ts'
import type { BackendEvidence } from './backend'
import type { Section } from './domain'

export type ReviewParagraph = { text: string; sentences: string[]; evidenceIds: string[]; missingIds: string[] }
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

// Current reports carry paragraph citations, not sentence/span provenance.
// Never infer a source from a matching number or from section.evidenceIds.
export function reviewParagraphs(content: string, availableIds: Set<string>, declaredIds: readonly string[] = []): ReviewParagraph[] {
  const declared = new Set(declaredIds)
  const isCitation = (id: string) => availableIds.has(id) || declared.has(id) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || id.startsWith('field:')
  return content.split(/\n\s*\n/).filter(Boolean).map(paragraph => {
    const ids = [...new Set([...paragraph.matchAll(/\[([^\]\n]+)\]/g)].map(match => match[1]).filter(isCitation))]
    const text = paragraph.replace(/\s*\[([^\]\n]+)\]/g, (match, id) => isCitation(id) ? '' : match).trim()
    const sentences = [...sentenceSegmenter.segment(text)].map(item => item.segment).filter(Boolean)
    return { text, sentences, evidenceIds: ids.filter(id => availableIds.has(id)), missingIds: ids.filter(id => !availableIds.has(id)) }
  })
}

export type ReviewAdvice = { id: string; evidence: Evidence; section: Section; conflict: boolean; message: string }
export function reviewAdvice(sections: Section[], evidence: Evidence[]): ReviewAdvice[] {
  const citingSections = new Map<string, Section>()
  for (const section of sections) {
    for (const match of section.content.matchAll(/\[([^\]\n]+)\]/g)) {
      if (!citingSections.has(match[1])) citingSections.set(match[1], section)
    }
  }
  return evidence.flatMap(item => {
    const section = citingSections.get(item.id)
    if (!section) return []
    const numericConflict = Boolean((item as Partial<BackendEvidence>).conflictNumbers)
    const claimConflict = section.sourceClaims?.some(claim => claim.reviewState === 'conflict' && claim.citations.some(citation => citation.evidence_id === item.id))
    const conflict = numericConflict || Boolean(claimConflict)
    if (!conflict && item.status !== 'Needs review') return []
    return [{ id: item.id, evidence: item, section, conflict, message: conflict
      ? `${numericConflict ? 'The backend flagged differing comparable values.' : 'The generated report flagged a source disagreement.'} Review the original values and sources, then revise the claim or explain the disagreement. Keep both source records until resolved.`
      : item.note || 'Review the source and qualify this statement before relying on it.' }]
  })
}
