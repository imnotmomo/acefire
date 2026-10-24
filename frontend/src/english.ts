import type { NarrativeCitation, Section, Workspace } from './domain'

export const hasChinese = (text: string): boolean => /\p{Script=Han}/u.test(text)

const legacyLabel = /“营业收入”|营业收入/g
const englishLabel = '“operating revenue” (translated source label)'

function revision(section: Section, content: string, at: string) {
  return { id: crypto.randomUUID(), at, section: section.id, title: section.title,
    before: section.content, after: content, author: 'English presentation translation' }
}

/** Translate the known built-in label without regenerating drafts or changing human wording. */
export function migrateLegacyEnglish(workspace: Workspace, at = new Date().toISOString()): Workspace {
  const changes: ReturnType<typeof revision>[] = []
  const sections = workspace.sections.map(section => {
    if (!section || typeof section.content !== 'string') return section
    const content = section.content.replace(legacyLabel, englishLabel)
    if (content === section.content) return section
    changes.push(revision(section, content, at))
    return { ...section, content }
  })
  return changes.length ? { ...workspace, sections, revisions: [...workspace.revisions, ...changes] } : workspace
}

function sectionNeedsEnglish(section: Section): boolean {
  return Boolean(section && ((Array.isArray(section.sourceClaims) && section.sourceClaims.some(claim => typeof claim?.text === 'string' && hasChinese(claim.text)))
    || (Array.isArray(section.gaps) && section.gaps.some(gap => typeof gap === 'string' && hasChinese(gap)))))
}

export function needsStoredEnglish(workspace: Workspace, reportIds: readonly string[]): boolean {
  return Boolean(workspace.backendDraftId && reportIds.includes(workspace.backendDraftId)
    && workspace.sections.some(sectionNeedsEnglish))
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value ?? null)
}

function citationBinding(citations: NarrativeCitation[]): string {
  return canonical(citations.map(citation => ({ evidence_id: citation.evidence_id, kind: citation.kind,
    quote: citation.quote, quote_basis: citation.quote_basis,
    sources: (citation.source ? [citation.source] : citation.sources ?? []).map(source => ({
      snapshot_id: source.snapshot_id, file_name: source.file_name, sha256: source.sha256, locator: source.locator,
    })),
  })))
}

function numbers(text: string): string {
  // Language validation only: compare equivalent magnitude notation without binary floats.
  const scales: Record<string, number> = { billion: 9, million: 6, thousand: 3, hundred: 2, '亿': 8, '万': 4, '千': 3, '百': 2 }
  const values = [...text.matchAll(/([+\-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(billion|million|thousand|hundred|亿|万|千|百))?/gi)].map(([, number, scale]) => {
    const normalized = number.replaceAll(',', '').replace('−', '-')
    const negative = normalized.startsWith('-')
    const [integer, fraction = ''] = normalized.replace(/^[+-]/, '').split('.')
    let digits = (integer + fraction).replace(/^0+/, '')
    let exponent = (scales[scale?.toLowerCase()] ?? 0) - fraction.length
    if (!digits) return '0'
    while (digits.endsWith('0')) { digits = digits.slice(0, -1); exponent++ }
    return `${negative ? '-' : ''}${digits}e${exponent}`
  })
  return JSON.stringify([...new Set(values)].sort())
}

function checkedTranslation(original: string, translated: string | undefined, serverChecked: boolean): string {
  if (!translated?.trim() || hasChinese(translated) || (!serverChecked && numbers(original) !== numbers(translated))) {
    throw new Error('The English presentation does not preserve the saved report text and numbers.')
  }
  return translated
}

/** Apply only exact known passages; edits, configuration, original quotations and history stay intact. */
export function migrateStoredEnglish(workspace: Workspace, englishSections: Section[], expectedDraftId: string, at = new Date().toISOString(), translation?: unknown): Workspace {
  if (workspace.backendDraftId !== expectedDraftId) return workspace
  // The server checks Chinese numeral/magnitude translation against the immutable original.
  // Only its bound presentation metadata may replace the conservative local number check.
  const metadata = translation && typeof translation === 'object' ? translation as Record<string, unknown> : null
  const serverChecked = Boolean(metadata && metadata.language === 'en' && metadata.original_records_preserved === true
    && typeof metadata.source_record_sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.source_record_sha256)
    && typeof metadata.manifest_sha256 === 'string' && /^[a-f0-9]{64}$/.test(metadata.manifest_sha256))
  if (translation !== undefined && !serverChecked) throw new Error('The English presentation has no valid source-version binding.')
  const changes: ReturnType<typeof revision>[] = []
  let changed = false
  const sections = workspace.sections.map(section => {
    const needsTranslation = sectionNeedsEnglish(section)
    if (!needsTranslation) return section
    const english = englishSections.find(item => item.id === section.id)
    if (!english) throw new Error('The English presentation is missing a saved report section.')
    let content = section.content
    const sourceClaims = section.sourceClaims?.map(claim => {
      if (!hasChinese(claim.text)) return claim
      const next = english.sourceClaims?.find(item => item.id === claim.id)
      if (!next || citationBinding(claim.citations) !== citationBinding(next.citations)) {
        throw new Error('The English presentation does not match the saved claim source references.')
      }
      const text = checkedTranslation(claim.text, next.text, serverChecked)
      content = content.replaceAll(claim.text, text)
      return { ...claim, text }
    })
    if (section.gaps?.some(hasChinese) && section.gaps.length !== english.gaps?.length) {
      throw new Error('The English presentation does not match the saved evidence gaps.')
    }
    const gaps = section.gaps?.map((gap, index) => {
      if (!hasChinese(gap)) return gap
      const translated = checkedTranslation(gap, english.gaps?.[index], serverChecked)
      content = content.replaceAll(gap, translated)
      return translated
    })
    changed = true
    changes.push(revision(section, content, at))
    return { ...section, content, sourceClaims, gaps }
  })
  return changed ? { ...workspace, sections, revisions: [...workspace.revisions, ...changes] } : workspace
}
