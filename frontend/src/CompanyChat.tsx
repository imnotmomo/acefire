import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyReport, BackendEvidence } from './backend'
import { apiFetch, reportEvidence } from './backend'
import type { Project, Section } from './domain'
import type { DataState } from './dataState'
import { dataStateLabel } from './dataState'
import { Badge, Dialog, Icon } from './ui'
import './company-chat.css'

type Citation = { evidence_id: string; quote: string; metadata?: Record<string, unknown> }
type Message = { id: string; role: 'user' | 'assistant'; content: string; state?: DataState; citations?: Citation[] }
type Conversation = { scope: string; messages: Message[] }
type Question = { scope: string; question: string; history: { role: 'user' | 'assistant'; content: string }[] }
type Failure = { message: string; stale: boolean }
type Props = { project: Project; page: string; report: CompanyReport; draftSections: Section[]; inspect: (id: string) => void; navigate: (path: string) => void; onClose: () => void }

const states = new Set<DataState>(['missing', 'verify', 'conflict'])
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`
const guidance: Record<DataState, string> = {
  missing: 'Supporting company evidence is missing for some or all of this question.',
  verify: 'Needs review. Linked evidence does not independently verify this answer.',
  conflict: 'Review the competing values or statements in their original sources.',
}
class ChatResponseError extends Error {
  stale: boolean
  constructor(message: string, stale = false) { super(message); this.stale = stale }
}

function checkedCitations(value: unknown, catalog: Map<string, BackendEvidence>): Citation[] {
  if (!Array.isArray(value) || value.length > 30) throw new ChatResponseError('The chat service returned unsupported source references. No answer was added.')
  return value.map(item => {
    if (!object(item) || typeof item.evidence_id !== 'string' || typeof item.quote !== 'string' || !item.quote.trim() || item.quote.length > 8000) throw new ChatResponseError('The chat service returned an invalid source quotation. No answer was added.')
    const evidence = catalog.get(item.evidence_id)
    const original = evidence?.citationText ?? evidence?.excerpt
    if (!evidence || typeof original !== 'string' || !original.includes(item.quote)) throw new ChatResponseError('A returned quotation is absent from the current company evidence. Refresh the stored report before retrying.')
    // Optional server metadata stays in memory. Inspection always uses fresh canonical evidence.
    const metadata: Record<string, unknown> = {}
    for (const key of ['kind', 'quote_basis', 'quote_match_rule', 'source', 'sources', 'document_claim_id', 'evidence_index', 'profile_snapshot_id', 'profile_pointer']) if (key in item) metadata[key] = item[key]
    return { evidence_id: item.evidence_id, quote: item.quote, metadata }
  })
}

function checkedReply(value: unknown, report: CompanyReport, catalog: Map<string, BackendEvidence>): Message {
  if (!object(value) || value.deal_id !== report.company.deal_id || value.report_id !== report.report_id) throw new ChatResponseError('This answer belongs to a different company or report version. Close chat and refresh the stored company report before asking again.', true)
  if (typeof value.answer !== 'string' || !value.answer.trim() || value.answer.length > 20_000 || typeof value.state !== 'string' || !states.has(value.state as DataState)) throw new ChatResponseError('The chat service returned an unsupported answer. No factual answer was added.')
  const citations = checkedCitations(value.citations, catalog)
  if (value.state !== 'missing' && citations.length === 0) throw new ChatResponseError('This answer did not include supporting source references. No factual answer was added.')
  return { id: crypto.randomUUID(), role: 'assistant', content: value.answer, state: value.state as DataState, citations }
}

function loadConversation(scope: string, catalog: Map<string, BackendEvidence>): Conversation {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(scope) || 'null')
    if (!object(raw) || !Array.isArray(raw.messages) || raw.messages.length > 40) return { scope, messages: [] }
    const messages: Message[] = []
    for (const item of raw.messages) {
      if (!object(item) || !['user', 'assistant'].includes(String(item.role)) || typeof item.content !== 'string' || !item.content.trim() || item.content.length > (item.role === 'user' ? 4000 : 20_000)) continue
      if (item.role === 'user') messages.push({ id: crypto.randomUUID(), role: 'user', content: item.content })
      else if (typeof item.state === 'string' && states.has(item.state as DataState)) {
        try {
          const citations = checkedCitations(item.citations, catalog)
          if (item.state === 'missing' || citations.length) messages.push({ id: crypto.randomUUID(), role: 'assistant', content: item.content, state: item.state as DataState, citations })
        } catch { /* Stale or invalid cached source references never become displayed answers. */ }
      }
    }
    return { scope, messages }
  } catch { return { scope, messages: [] } }
}

function workingDraft(sections: Section[]) {
  return sections.map(section => ({
    id: section.id, title: section.title, content: section.content, evidenceIds: section.evidenceIds,
    config: section.config, gaps: section.gaps, humanEdited: section.humanEdited, generation: section.generation,
    sourceClaims: section.sourceClaims?.map(claim => ({ id: claim.id, text: claim.text, kind: claim.kind,
      citations: claim.citations.map(citation => ({ evidence_id: citation.evidence_id, kind: citation.kind, quote: citation.quote, quote_basis: citation.quote_basis })) })),
  }))
}

export default function CompanyChat({ project, page, report, draftSections, inspect, navigate, onClose }: Props) {
  const catalog = useMemo(() => new Map(reportEvidence(report).map(evidence => [evidence.id, evidence])), [report])
  const scope = `acefire:company-chat:v1:${encodeURIComponent(report.company.deal_id)}:${encodeURIComponent(report.report_id)}`
  const [conversation, setConversation] = useState<Conversation>(() => loadConversation(scope, catalog))
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const messages = conversation.scope === scope ? conversation.messages : []
  const scopeRef = useRef(scope); scopeRef.current = scope
  const controllerRef = useRef<AbortController | null>(null)
  const questionRef = useRef<Question | null>(null)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { mounted.current = true; inputRef.current?.focus(); return () => { mounted.current = false; controllerRef.current?.abort() } }, [])
  useEffect(() => {
    controllerRef.current?.abort(); controllerRef.current = null; inFlight.current = false
    setConversation(loadConversation(scope, catalog)); setInput(''); setBusy(false); setFailure(null); questionRef.current = null
  }, [scope])
  useEffect(() => {
    if (conversation.scope !== scope) return
    try {
      // Never persist source objects, download URLs, API tokens or optional server metadata.
      sessionStorage.setItem(scope, JSON.stringify({ messages: conversation.messages.slice(-40).map(message => ({
        role: message.role, content: message.content, state: message.state,
        citations: message.citations?.map(citation => ({ evidence_id: citation.evidence_id, quote: citation.quote })),
      })) }))
    } catch { /* The active in-memory conversation remains usable if browser storage is unavailable. */ }
  }, [conversation, scope])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length, busy, failure])

  async function perform(question: Question) {
    if (inFlight.current || question.scope !== scopeRef.current) return
    inFlight.current = true; setBusy(true); setFailure(null); questionRef.current = question
    const controller = new AbortController(); controllerRef.current = controller
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(report.company.deal_id)}/chat`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ question: question.question, report_id: report.report_id, context_scope: 'entire_company', page,
          history: question.history, working_draft: { sections: workingDraft(draftSections), verification: 'unverified_human_draft' } }),
      })
      if ([404, 405, 501, 503].includes(response.status)) throw new ChatResponseError('Company chat is waiting for the team service. Your question is kept here; retry when the service is connected.')
      if ([401, 403].includes(response.status)) throw new ChatResponseError('Sign in again to access this company chat. Your question has been kept.')
      if (!response.ok) throw new ChatResponseError('Company chat could not answer right now. Your question has been kept; you can retry.')
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ChatResponseError('The chat service returned an unsupported response. No answer was added.')
      const raw = await response.text()
      if (new TextEncoder().encode(raw).length > 200_000) throw new ChatResponseError('The chat service returned an oversized response. No answer was added.')
      let payload: unknown
      try { payload = JSON.parse(raw) } catch { throw new ChatResponseError('The chat service returned invalid answer data. No answer was added.') }
      const answer = checkedReply(payload, report, catalog)
      if (mounted.current && !controller.signal.aborted && scopeRef.current === question.scope) setConversation(previous => ({ scope: question.scope, messages: [...(previous.scope === question.scope ? previous.messages : []), answer].slice(-40) }))
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && scopeRef.current === question.scope) setFailure({ message: error instanceof ChatResponseError ? error.message : 'The company chat service could not be reached. Your question has been kept; you can retry.', stale: error instanceof ChatResponseError && error.stale })
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null; inFlight.current = false
        if (mounted.current && scopeRef.current === question.scope) { setBusy(false); inputRef.current?.focus() }
      }
    }
  }

  function send(question: string) {
    const text = question.trim()
    if (!text || text.length > 4000 || inFlight.current) return
    const history = messages.slice(-20).map(message => ({ role: message.role, content: message.content }))
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    setConversation({ scope, messages: [...messages, userMessage].slice(-40) })
    setInput(''); void perform({ scope, question: text, history })
  }

  return <Dialog title="Company chat" subtitle={`${project.name} · ${page}`} onClose={onClose} className="company-chat-dialog">
    <div className="company-chat-context"><div><Icon name="layers" size={17} /><strong>Company-wide evidence</strong><Badge tone="blue">All company context</Badge></div><p>{countLabel(report.source_files.length, 'file')} · {countLabel(report.document_claims?.filter(claim => claim.claim_type !== 'report_source_quotation').length ?? 0, 'document claim')}{report.document_claims?.some(claim => claim.claim_type === 'report_source_quotation') && ` · ${countLabel(report.document_claims.filter(claim => claim.claim_type === 'report_source_quotation').length, 'report quotation')}`} · {countLabel(report.reported_metrics.length, 'observation')} · {countLabel(report.calculations.length, 'calculation')}</p><small>The service is asked to use the whole company record, beyond the rows visible on this page.</small></div>
    <div className="company-chat-messages" role="log" aria-live="polite" aria-label={`${project.name} conversation`}>
      {messages.length === 0 && <div className="company-chat-welcome"><span className="company-chat-mark"><Icon name="chat" size={26} /></span><h3>Ask about {project.name}.<br />Keep the source in sight.</h3><p>Explore the company, understand a calculation, or identify a gap. Responses need review against their evidence.</p><div className="company-chat-prompts">{[`Explain the latest calculation for ${project.name}.`, `What evidence is missing for ${project.name}?`, `Summarize ${project.name} with sources.`].map(prompt => <button key={prompt} onClick={() => send(prompt)} disabled={busy}>{prompt}<Icon name="outward" size={14} /></button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={`company-chat-message ${message.role}`}><div className="company-chat-message-heading"><strong>{message.role === 'user' ? 'You' : 'Ingenium'}</strong>{message.state && <Badge tone={message.state === 'conflict' ? 'amber' : message.state === 'missing' ? 'neutral' : 'blue'}>{dataStateLabel(message.state)}</Badge>}</div><p className="company-chat-answer">{message.content}</p>{message.state && <small className="company-chat-guidance">{guidance[message.state]}</small>}{Boolean(message.citations?.length) && <div className="company-chat-citations">{message.citations!.map((citation, index) => {
        const evidence = catalog.get(citation.evidence_id)
        return <div key={`${citation.evidence_id}:${index}`}><button className="citation" aria-label={`Inspect ${evidence?.title || 'source'} evidence`} onClick={() => { onClose(); inspect(citation.evidence_id) }}><Icon name="link" size={12} />{evidence?.title || 'Source evidence'}<Icon name="outward" size={12} /></button><details><summary>{evidence?.quoteBasis === 'structured_record' ? 'Quoted structured record' : 'Quoted source text'}</summary><blockquote>{citation.quote}</blockquote></details></div>
      })}</div>}</article>)}
      {busy && <div className="company-chat-waiting" role="status"><Icon name="loading" size={17} /><span>Looking across company evidence…</span></div>}
      {failure && <div className="company-chat-error" role="alert"><Icon name="help" size={18} /><div><p>{failure.message}</p>{!failure.stale && questionRef.current && <button className="button secondary" onClick={() => { if (questionRef.current) void perform(questionRef.current) }} disabled={busy}>Retry question<Icon name="arrow" size={14} /></button>}{failure.stale && <button className="button secondary" onClick={() => { onClose(); navigate(`/project/${project.id}/dashboard`) }}>Return to company<Icon name="arrow" size={14} /></button>}</div></div>}
      <div ref={endRef} />
    </div>
    <form className="company-chat-input" onSubmit={event => { event.preventDefault(); send(input) }}><label className="sr-only" htmlFor="company-chat-question">Ask about this company</label><input id="company-chat-question" ref={inputRef} aria-label="Ask about this company" placeholder={`Ask about ${project.name}…`} value={input} onChange={event => setInput(event.target.value)} maxLength={4000} readOnly={busy} autoComplete="off" /><button className="icon-button" type="submit" aria-label="Send company question" disabled={busy || !input.trim()}><Icon name={busy ? 'loading' : 'send'} size={19} /></button></form>
    <div className="company-chat-footer"><span>Verify means needs review. Your working draft is unverified context.</span><button className="text-button" onClick={() => { onClose(); navigate(`/project/${project.id}/data-room`) }}>View company sources<Icon name="outward" size={12} /></button></div>
  </Dialog>
}
