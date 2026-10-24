import type { CompanyReport, BackendEvidence } from './backend'
import type { DataState } from './dataState'
import type { Section } from './domain'

export type Citation = { evidence_id: string; quote: string; metadata?: Record<string, unknown> }
export type Message = { id: string; role: 'user' | 'assistant'; content: string; state?: DataState; citations?: Citation[] }
export type Conversation = { scope: string; messages: Message[] }
export type Question = { scope: string; question: string; history: { role: 'user' | 'assistant'; content: string }[] }
export type Failure = { message: string; stale: boolean }
export type RecoveryState = 'pending' | 'retry' | 'stale'

const states = new Set<DataState>(['missing', 'verify', 'conflict'])
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
export const chatScope = (dealId: string, reportId: string) => `acefire:company-chat:v1:${encodeURIComponent(dealId)}:${encodeURIComponent(reportId)}`
export const recoveryKey = (dealId: string) => `acefire:company-chat-recovery:v1:${encodeURIComponent(dealId)}`

export class ChatResponseError extends Error {
  stale: boolean
  constructor(message: string, stale = false) { super(message); this.stale = stale }
}

export function chatRequestError(status: number, payload?: unknown): ChatResponseError {
  if (status === 409) return new ChatResponseError('Company evidence changed. Refresh the company evidence, then retry your preserved question.', true)
  const detail = object(payload) ? payload.detail : undefined
  const message = typeof detail === 'string' ? detail : object(detail) && typeof detail.message === 'string' ? detail.message : ''
  if (message.trim()) return new ChatResponseError(`${message.slice(0, 500)} Your question has been kept.`)
  if ([401, 403].includes(status)) return new ChatResponseError('The company service denied this request. Check the backend connection; your question has been kept.')
  if ([404, 405, 501].includes(status)) return new ChatResponseError('Company chat is unavailable for this company. Your question has been kept; retry after the company service is connected.')
  return new ChatResponseError('Company chat could not answer right now. Your question has been kept; you can retry.')
}

export function checkedCitations(value: unknown, catalog: Map<string, BackendEvidence>): Citation[] {
  if (!Array.isArray(value) || value.length > 30) throw new ChatResponseError('The chat service returned unsupported source references. No answer was added.')
  return value.map(item => {
    if (!object(item) || typeof item.evidence_id !== 'string' || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 8000) throw new ChatResponseError('The chat service returned an invalid source quotation. No answer was added.')
    const evidence = catalog.get(item.evidence_id)
    const original = evidence?.citationText ?? evidence?.excerpt
    if (!evidence || typeof original !== 'string' || !original.includes(item.quote)) throw new ChatResponseError('A returned quotation is absent from the current company evidence. Refresh the stored report before retrying.')
    const metadata: Record<string, unknown> = {}
    for (const key of ['kind', 'quote_basis', 'quote_match_rule', 'source', 'sources', 'document_claim_id', 'evidence_index', 'profile_snapshot_id', 'profile_pointer']) if (key in item) metadata[key] = item[key]
    return { evidence_id: item.evidence_id, quote: item.quote, metadata }
  })
}

export function checkedReply(value: unknown, report: CompanyReport, catalog: Map<string, BackendEvidence>): Message {
  if (!object(value) || value.deal_id !== report.company.deal_id || value.report_id !== report.report_id) throw new ChatResponseError('This answer belongs to a different company or report version. Refresh the company evidence before retrying your preserved question.', true)
  if (typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 20_000 || typeof value.state !== 'string' || !states.has(value.state as DataState)) throw new ChatResponseError('The chat service returned an unsupported answer. No factual answer was added.')
  const citations = checkedCitations(value.citations, catalog)
  if (value.state !== 'missing' && citations.length === 0) throw new ChatResponseError('This answer did not include supporting source references. No factual answer was added.')
  return { id: crypto.randomUUID(), role: 'assistant', content: value.answer, state: value.state as DataState, citations }
}

export function storedMessages(messages: Message[]) {
  return messages.slice(-40).map(message => ({ role: message.role, content: message.content, state: message.state,
    citations: message.citations?.map(citation => ({ evidence_id: citation.evidence_id, quote: citation.quote })) }))
}

function checkedMessages(value: unknown, catalog: Map<string, BackendEvidence>): Message[] {
  if (!Array.isArray(value) || value.length > 40) return []
  return value.flatMap((item): Message[] => {
    if (!object(item) || !['user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > (item.role === 'user' ? 4000 : 20_000)) return []
    if (item.role === 'user') return [{ id: crypto.randomUUID(), role: 'user' as const, content: item.content }]
    if (typeof item.state !== 'string' || !states.has(item.state as DataState)) return []
    try {
      const citations = checkedCitations(item.citations, catalog)
      return item.state === 'missing' || citations.length ? [{ id: crypto.randomUUID(), role: 'assistant' as const, content: item.content, state: item.state as DataState, citations }] : []
    } catch { return [] }
  })
}

/** The editable report is optional context; it must not make company-wide chat unusable. */
export function chatWorkingDraft(sections: Section[]) {
  const data = { sections: sections.map(section => ({
    id: section.id, title: section.title, content: section.content, evidenceIds: section.evidenceIds,
    config: section.config, gaps: section.gaps, humanEdited: section.humanEdited, generation: section.generation,
    sourceClaims: section.sourceClaims?.map(claim => ({ id: claim.id, text: claim.text, kind: claim.kind,
      citations: claim.citations.map(citation => ({ evidence_id: citation.evidence_id, kind: citation.kind, quote: citation.quote, quote_basis: citation.quote_basis })) })),
  })), verification: 'unverified_human_draft' }
  if (new TextEncoder().encode(JSON.stringify(data)).length <= 240_000) return { data, omitted: false }
  return { data: { sections: [], verification: 'unverified_human_draft', omitted: true,
    reason: 'The working draft exceeds the chat context limit. Its edits remain in the report editor; all stored company evidence is supplied separately.' }, omitted: true }
}

export function readConversation(raw: string | null, scope: string, catalog: Map<string, BackendEvidence>): Conversation {
  try {
    if (!raw || raw.length > 1_500_000) return { scope, messages: [] }
    const value: unknown = JSON.parse(raw)
    return { scope, messages: object(value) ? checkedMessages(value.messages, catalog) : [] }
  } catch { return { scope, messages: [] } }
}

export function encodeRecovery(dealId: string, reportId: string, question: Question, messages: Message[], state: RecoveryState): string {
  return JSON.stringify({ version: 1, dealId, reportId, question: question.question, history: question.history,
    messages: storedMessages(messages), state })
}

/** Rebind a pending question to fresh report metadata; never replay its stale report ID. */
export function recoverChat(raw: string | null, dealId: string, reportId: string, catalog: Map<string, BackendEvidence>): { conversation: Conversation; question: Question; failure: Failure } | null {
  try {
    if (!raw || raw.length > 1_500_000) return null
    const value: unknown = JSON.parse(raw)
    if (!object(value) || value.version !== 1 || value.dealId !== dealId || typeof value.reportId !== 'string' || !value.reportId || value.reportId.length > 200
      || typeof value.question !== 'string' || !value.question.trim() || value.question.length > 4000 || !Array.isArray(value.history) || value.history.length > 20
      || !value.history.every(item => object(item) && ['user', 'assistant'].includes(String(item.role)) && typeof item.content === 'string' && item.content.length > 0 && item.content.length <= 20_000)
      || !['pending', 'retry', 'stale'].includes(String(value.state))) return null
    const scope = chatScope(dealId, reportId)
    const stale = value.reportId === reportId && value.state === 'stale'
    return { conversation: { scope, messages: checkedMessages(value.messages, catalog) },
      question: { scope, question: value.question, history: value.history as Question['history'] },
      failure: { stale, message: stale ? 'Company evidence changed. Refresh it before retrying your preserved question.'
        : value.reportId !== reportId ? 'Company evidence refreshed. Retry your preserved question using the current sources.'
          : 'Your previous question was interrupted. Retry it when you are ready.' } }
  } catch { return null }
}
