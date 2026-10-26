import { useEffect, useMemo, useRef, useState } from 'react'
import type { CompanyReport, BackendEvidence } from './backend'
import { apiFetch, reportEvidence } from './backend'
import type { Project, Section } from './domain'
import type { DataState } from './dataState'
import { ChatResponseError, chatScope, chatRequestError, chatWorkingDraft, checkedReply, encodeRecovery, readConversation, recoverChat, recoveryKey, storedMessages } from './companyChatState'
import type { Conversation, Failure, Message, Question, RecoveryState } from './companyChatState'
import { dataStateLabel } from './dataState'
import { readChatDraft, saveChatDraft } from './chatPersistence'
import { Badge, Dialog, Icon } from './ui'
import './company-chat.css'

type Props = { project: Project; page: string; report: CompanyReport; draftSections: Section[]; inspect: (id: string) => void; navigate: (path: string) => void; onClose: () => void; onRefresh?: () => void; onSearchSources?: () => void }

const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`
const guidance: Record<DataState, string> = {
  missing: 'Supporting company evidence is missing for some or all of this question.',
  verify: 'Needs review. Linked evidence does not independently verify this answer.',
  conflict: 'Review the competing values or statements in their original sources.',
}
function loadConversation(scope: string, catalog: Map<string, BackendEvidence>): Conversation {
  try { return readConversation(sessionStorage.getItem(scope), scope, catalog) }
  catch { return { scope, messages: [] } }
}

export default function CompanyChat({ project, page, report, draftSections, inspect, navigate, onClose, onRefresh, onSearchSources }: Props) {
  const catalog = useMemo(() => new Map(reportEvidence(report).map(evidence => [evidence.id, evidence])), [report])
  const workingDraft = useMemo(() => chatWorkingDraft(draftSections), [draftSections])
  const scope = chatScope(report.company.deal_id, report.report_id)
  const [conversation, setConversation] = useState<Conversation>(() => loadConversation(scope, catalog))
  const conversationRef = useRef(conversation); conversationRef.current = conversation
  const recoveryRef = useRef<string | null>(null)
  const [input, setInput] = useState(() => readChatDraft(report.company.deal_id, 'company'))
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

  function saveRecovery(question: Question, state: RecoveryState) {
    const value = encodeRecovery(report.company.deal_id, report.report_id, question, conversationRef.current.messages, state)
    recoveryRef.current = value
    try { sessionStorage.setItem(recoveryKey(report.company.deal_id), value) } catch { /* In-memory recovery still works while the dialog stays mounted. */ }
  }
  function clearRecovery() {
    recoveryRef.current = null
    try { sessionStorage.removeItem(recoveryKey(report.company.deal_id)) } catch { /* The current answer is still available in memory. */ }
  }

  useEffect(() => { mounted.current = true; inputRef.current?.focus(); return () => { mounted.current = false; controllerRef.current?.abort() } }, [])
  useEffect(() => {
    controllerRef.current?.abort(); controllerRef.current = null; inFlight.current = false
    let saved = recoveryRef.current
    if (!saved) try { saved = sessionStorage.getItem(recoveryKey(report.company.deal_id)) } catch { /* Browser storage may be unavailable. */ }
    const recovered = recoverChat(saved, report.company.deal_id, report.report_id, catalog)
    const next = recovered?.conversation ?? loadConversation(scope, catalog)
    conversationRef.current = next
    setConversation(next); setBusy(false); setFailure(recovered?.failure ?? null); questionRef.current = recovered?.question ?? null
    setInput(readChatDraft(report.company.deal_id, 'company'))
  }, [scope])
  useEffect(() => {
    if (conversation.scope !== scope) return
    try {
      // Never persist source objects, download URLs, API tokens or optional server metadata.
      sessionStorage.setItem(scope, JSON.stringify({ messages: storedMessages(conversation.messages) }))
    } catch { /* The active in-memory conversation remains usable if browser storage is unavailable. */ }
  }, [conversation, scope])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length, busy, failure])

  async function perform(question: Question) {
    if (inFlight.current || question.scope !== scopeRef.current) return
    inFlight.current = true; setBusy(true); setFailure(null); questionRef.current = question
    const controller = new AbortController(); controllerRef.current = controller
    saveRecovery(question, 'pending')
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(report.company.deal_id)}/chat`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ question: question.question, report_id: report.report_id, context_scope: 'entire_company', page,
          history: question.history, working_draft: workingDraft.data }),
      })
      if (!response.ok) {
        let payload: unknown
        try {
          const raw = await response.text()
          if (response.headers.get('content-type')?.includes('application/json') && raw.length <= 200_000) payload = JSON.parse(raw)
        } catch { /* Status-specific recovery remains available without an error body. */ }
        throw chatRequestError(response.status, payload)
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new ChatResponseError('The chat service returned an unsupported response. No answer was added.')
      const raw = await response.text()
      if (new TextEncoder().encode(raw).length > 200_000) throw new ChatResponseError('The chat service returned an oversized response. No answer was added.')
      let payload: unknown
      try { payload = JSON.parse(raw) } catch { throw new ChatResponseError('The chat service returned invalid answer data. No answer was added.') }
      const answer = checkedReply(payload, report, catalog)
      if (mounted.current && !controller.signal.aborted && scopeRef.current === question.scope) {
        clearRecovery()
        setConversation(previous => ({ scope: question.scope, messages: [...(previous.scope === question.scope ? previous.messages : []), answer].slice(-40) }))
      }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && scopeRef.current === question.scope) {
        const failure = { message: error instanceof ChatResponseError ? error.message : 'The company chat service could not be reached. Your question has been kept; you can retry.', stale: error instanceof ChatResponseError && error.stale }
        saveRecovery(question, failure.stale ? 'stale' : 'retry'); setFailure(failure)
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null; inFlight.current = false
        if (mounted.current && scopeRef.current === question.scope) { setBusy(false); inputRef.current?.focus() }
      }
    }
  }

  function send(question: string) {
    const text = question.trim()
    if (!text || text.length > 4000 || inFlight.current || failure?.stale) return
    const history = messages.slice(-20).map(message => ({ role: message.role, content: message.content }))
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const next: Conversation = { scope, messages: [...messages, userMessage].slice(-40) }
    conversationRef.current = next; setConversation(next)
    setInput(''); saveChatDraft(report.company.deal_id, 'company', ''); void perform({ scope, question: text, history })
  }

  return <Dialog title="Company chat" subtitle={`${project.name} · ${page}`} onClose={onClose} className="company-chat-dialog">
    <div className="company-chat-context"><div><Icon name="layers" size={17} /><strong>Company-wide evidence</strong><Badge tone="blue">All company context</Badge></div><p>{countLabel(report.source_files.length, 'file')} · {countLabel(report.document_claims?.filter(claim => claim.claim_type !== 'report_source_quotation').length ?? 0, 'document claim')}{report.document_claims?.some(claim => claim.claim_type === 'report_source_quotation') && ` · ${countLabel(report.document_claims.filter(claim => claim.claim_type === 'report_source_quotation').length, 'report quotation')}`} · {countLabel(report.reported_metrics.length, 'observation')} · {countLabel(report.calculations.length, 'calculation')}</p><small>The service is asked to use the whole company record, beyond the rows visible on this page.</small>{onSearchSources && <button className="text-button" onClick={onSearchSources}>Search source files<Icon name="search" size={13} /></button>}</div>
    {workingDraft.omitted && <p className="company-chat-guidance" role="status">Your report is too large to include as chat context. Its edits stay in the report editor; all stored company evidence is still available to chat.</p>}
    <div className="company-chat-messages" role="log" aria-live="polite" aria-label={`${project.name} conversation`}>
      {messages.length === 0 && <div className="company-chat-welcome"><span className="company-chat-mark"><Icon name="chat" size={26} /></span><h3>Ask about {project.name}.<br />Keep the source in sight.</h3><p>Explore the company, understand a calculation, or identify a gap. Responses need review against their evidence.</p><div className="company-chat-prompts">{[`Explain the latest calculation for ${project.name}.`, `What evidence is missing for ${project.name}?`, `Summarize ${project.name} with sources.`].map(prompt => <button key={prompt} onClick={() => send(prompt)} disabled={busy || Boolean(failure?.stale)}>{prompt}<Icon name="outward" size={14} /></button>)}</div></div>}
      {messages.map(message => <article key={message.id} className={`company-chat-message ${message.role}`}><div className="company-chat-message-heading"><strong>{message.role === 'user' ? 'You' : 'Ingenium'}</strong>{message.state && <Badge tone={message.state === 'conflict' ? 'amber' : message.state === 'missing' ? 'neutral' : 'blue'}>{dataStateLabel(message.state)}</Badge>}</div><p className="company-chat-answer">{message.content}</p>{message.state && <small className="company-chat-guidance">{guidance[message.state]}</small>}{Boolean(message.citations?.length) && <div className="company-chat-citations">{message.citations!.map((citation, index) => {
        const evidence = catalog.get(citation.evidence_id)
        return <div key={`${citation.evidence_id}:${index}`}><button className="citation" aria-label={`Inspect ${evidence?.title || 'source'} evidence`} onClick={() => { onClose(); inspect(citation.evidence_id) }}><Icon name="link" size={12} />{evidence?.title || 'Source evidence'}<Icon name="outward" size={12} /></button><details><summary>{evidence?.quoteBasis === 'structured_record' ? 'Quoted structured record' : 'Quoted source text'}</summary><blockquote>{citation.quote}</blockquote></details></div>
      })}</div>}</article>)}
      {busy && <div className="company-chat-waiting" role="status"><Icon name="loading" size={17} /><span>Looking across company evidence…</span></div>}
      {failure && <div className="company-chat-error" role="alert"><Icon name="help" size={18} /><div><p>{failure.message}</p>{!failure.stale && questionRef.current && <button className="button secondary" onClick={() => { if (questionRef.current) void perform(questionRef.current) }} disabled={busy}>Retry question<Icon name="arrow" size={14} /></button>}{failure.stale && <button className="button secondary" onClick={() => { if (onRefresh) onRefresh(); else window.location.reload() }}>Refresh company evidence<Icon name="history" size={14} /></button>}</div></div>}
      <div ref={endRef} />
    </div>
    <form className="company-chat-input" onSubmit={event => { event.preventDefault(); send(input) }}><label className="sr-only" htmlFor="company-chat-question">Ask about this company</label><input id="company-chat-question" ref={inputRef} aria-label="Ask about this company" placeholder={`Ask about ${project.name}…`} value={input} onChange={event => { setInput(event.target.value); saveChatDraft(report.company.deal_id, 'company', event.target.value) }} maxLength={4000} readOnly={busy || Boolean(failure?.stale)} autoComplete="off" /><button className="icon-button" type="submit" aria-label="Send company question" disabled={busy || Boolean(failure?.stale) || !input.trim()}><Icon name={busy ? 'loading' : 'send'} size={19} /></button></form>
    <div className="company-chat-footer"><span>Verify means needs review. Your working draft is unverified context.</span><button className="text-button" onClick={() => { onClose(); navigate(`/project/${project.id}/data-room`) }}>View company sources<Icon name="outward" size={12} /></button></div>
  </Dialog>
}
