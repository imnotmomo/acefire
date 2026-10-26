import { useEffect, useRef, useState } from 'react'
import type { Project } from './domain'
import type { BackendSource, CompanyReport } from './backend'
import { apiFetch, formatLocator } from './backend'
import { documentChatDeal, documentChatError, documentQuestionKey, pendingDocumentQuestion, parseDocumentReply } from './documentChatState'
import { documentConversationKey, encodeDocumentConversation, readChatDraft, readDocumentConversation, saveChatDraft } from './chatPersistence'
import type { DocumentMessage } from './chatPersistence'
import SourceFileButton from './SourceFileButton'
import SourceFilePreview from './SourceFilePreview'
import { Badge, Dialog, Icon } from './ui'
import './company-chat.css'
import './document-chat.css'

type Props = { project: Project; page: string; report?: CompanyReport; inspect?: (id: string) => void; navigate?: (path: string) => void; onClose: () => void; onCompanyChat?: () => void }
function loadConversation(dealId: string | null, report?: CompanyReport): DocumentMessage[] {
  try { return dealId ? readDocumentConversation(sessionStorage.getItem(documentConversationKey(dealId)), dealId, report) : [] }
  catch { return [] }
}

export default function DocumentChat({ project, page, report, onClose, onCompanyChat }: Props) {
  const dealId = documentChatDeal(project)
  const [input, setInput] = useState(() => readChatDraft(dealId, 'sources'))
  const [conversation, setConversation] = useState<{ dealId: string | null; messages: DocumentMessage[] }>(() => ({ dealId, messages: loadConversation(dealId, report) }))
  const messages = conversation.dealId === dealId ? conversation.messages : []
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const [preview, setPreview] = useState<BackendSource | null>(null)
  const pending = useRef('')
  const inFlight = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const context = useRef(dealId); context.current = dealId
  const mounted = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    mounted.current = true; controller.current?.abort(); controller.current = null; inFlight.current = false
    let previous = '', saved: DocumentMessage[] = []
    if (dealId) try { previous = pendingDocumentQuestion(sessionStorage.getItem(documentQuestionKey(dealId))); saved = readDocumentConversation(sessionStorage.getItem(documentConversationKey(dealId)), dealId, report) } catch { /* The active dialog remains usable without browser storage. */ }
    pending.current = previous
    if (previous && saved.at(-1)?.text !== previous) saved.push({ id: crypto.randomUUID(), role: 'user', text: previous })
    setInput(readChatDraft(dealId, 'sources')); setConversation({ dealId, messages: saved.slice(-40) }); setBusy(false)
    setFailure(previous ? 'Your previous source question was interrupted. Retry it when you are ready.' : ''); setPreview(null)
    inputRef.current?.focus()
    return () => { mounted.current = false; controller.current?.abort() }
  }, [dealId, report])
  useEffect(() => {
    if (!dealId || conversation.dealId !== dealId) return
    try { sessionStorage.setItem(documentConversationKey(dealId), encodeDocumentConversation(dealId, conversation.messages)) } catch { /* The validated conversation remains available while open. */ }
  }, [conversation, dealId])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [messages.length, busy, failure])

  async function send(question: string, retry = false) {
    const trimmed = question.trim()
    if (!dealId || !trimmed || trimmed.length > 4000 || inFlight.current) return
    const request = new AbortController(); controller.current = request; inFlight.current = true; pending.current = trimmed
    try { sessionStorage.setItem(documentQuestionKey(dealId), trimmed) } catch { /* In-memory retry remains available. */ }
    if (!retry) setConversation(previous => ({ dealId, messages: [...(previous.dealId === dealId ? previous.messages : []), { id: crypto.randomUUID(), role: 'user' as const, text: trimmed }].slice(-40) }))
    setInput(''); saveChatDraft(dealId, 'sources', ''); setBusy(true); setFailure('')
    try {
      const response = await apiFetch(`/deals/${encodeURIComponent(dealId)}/evidence-chat`, { method: 'POST', signal: request.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ question: trimmed }) })
      const raw = await response.text()
      if (new TextEncoder().encode(raw).length > 512_000) throw new Error('The source-search response is too large to display safely. Your question is preserved.')
      let payload: unknown
      if (response.headers.get('content-type')?.includes('application/json')) {
        try { payload = JSON.parse(raw) } catch { throw new Error('The source-search service returned invalid JSON. No factual answer was added.') }
      } else if (response.ok) throw new Error('The source-search API did not return JSON. Check the backend connection.')
      if (!response.ok) throw new Error(documentChatError(response.status, payload))
      const reply = parseDocumentReply(payload, dealId, report)
      if (mounted.current && !request.signal.aborted && context.current === dealId) {
        setConversation(previous => ({ dealId, messages: [...(previous.dealId === dealId ? previous.messages : []), { id: crypto.randomUUID(), role: 'assistant' as const, text: reply.answer, reply }].slice(-40) })); pending.current = ''
        try { sessionStorage.removeItem(documentQuestionKey(dealId)) } catch { /* The validated answer is already in memory. */ }
      }
    } catch (error) {
      if (mounted.current && !request.signal.aborted && context.current === dealId) setFailure(error instanceof Error ? error.message : 'Unable to reach source search. Your question is preserved.')
    } finally {
      if (controller.current === request) {
        controller.current = null; inFlight.current = false
        if (mounted.current && context.current === dealId) { setBusy(false); inputRef.current?.focus() }
      }
    }
  }

  return <Dialog title="Search source files" subtitle={`${project.name} · ${page}`} onClose={onClose} className="company-chat-dialog document-chat-dialog">
    <div className="company-chat-context"><div><Icon name="search" size={17} /><strong>Search the original evidence</strong><Badge tone="blue">Source search</Badge></div><p>Registered files and stored source records · citations included</p><small>Search retrieves a bounded selection of excerpts. Company chat uses the full stored company context.</small>{onCompanyChat && <button className="text-button document-chat-switch" onClick={onCompanyChat}>Back to company chat<Icon name="chat" size={13} /></button>}</div>
    {preview ? <div className="document-chat-file"><button className="text-button" onClick={() => { setPreview(null); requestAnimationFrame(() => inputRef.current?.focus()) }}><Icon name="back" size={14} />Back to conversation</button><SourceFilePreview key={`${preview.snapshot_id}:${JSON.stringify(preview.locator)}`} source={preview} /></div> : <>
      <div className="company-chat-messages" role="log" aria-live="polite" aria-label={`${project.name} source search`}>
        {!dealId && <div className="company-chat-error" role="alert"><Icon name="help" size={18} /><p>This project has no connected backend company. Open a connected company or create a backend workspace before searching its files.</p></div>}
        {dealId && messages.length === 0 && <div className="company-chat-welcome"><span className="company-chat-mark"><Icon name="search" size={26} /></span><h3>Ask a question.<br />Read the original source.</h3><p>Every returned statement names the evidence behind it. Source gaps and historical context remain visible.</p><div className="company-chat-prompts">{['Where does revenue come from?', 'What evidence supports customer growth?', 'Which financial values conflict?', 'What are the evidence gaps?'].map(prompt => <button key={prompt} onClick={() => void send(prompt)} disabled={busy}>{prompt}<Icon name="outward" size={14} /></button>)}</div></div>}
        {messages.map(message => <article key={message.id} className={`company-chat-message ${message.role}`}><div className="company-chat-message-heading"><strong>{message.role === 'assistant' ? 'Ingenium' : 'You'}</strong>{message.reply && <Badge tone={message.reply.status === 'answered' ? 'blue' : 'neutral'}>{message.reply.status === 'answered' ? 'Verify' : 'Missing'}</Badge>}</div><p className="company-chat-answer">{message.text}</p>
          {Boolean(message.reply?.sources.length) && <div className="document-chat-sources">{message.reply!.sources.map(source => <details key={source.id}><summary><span>[{source.label}]</span>{source.source.file_name} · {formatLocator(source.source.locator)}</summary><blockquote>{source.excerpt}</blockquote><dl><dt>Source record</dt><dd>{source.kind} · {source.id}</dd><dt>SHA-256</dt><dd className="hash">{source.source.sha256}</dd></dl><SourceFileButton source={source.source} onOpen={setPreview} /></details>)}</div>}
          {Boolean(message.reply?.gaps.length) && <div className="document-chat-gaps"><strong>Evidence gaps</strong>{message.reply!.gaps.map((gap, index) => <p key={index}>{gap}</p>)}</div>}
          {message.reply && <details className="document-chat-coverage"><summary>{message.reply.coverage.retrieved_chunks} retrieved excerpts · {message.reply.coverage.registered_sources} registered sources</summary>{message.reply.coverage.source_gaps.map((gap, index) => <p key={index}>{report?.source_files.find(source => source.snapshot_id === gap.snapshot_id)?.file_name ?? gap.snapshot_id}: {gap.reason}</p>)}<p>Automated source support is not independent factual verification. Search may miss relevant evidence.</p></details>}
        </article>)}
        {busy && <div className="company-chat-waiting" role="status"><Icon name="loading" size={17} /><span>Retrieving evidence and checking citations…</span></div>}
        {failure && <div className="company-chat-error" role="alert"><Icon name="help" size={18} /><div><p>{failure}</p>{pending.current && <button className="button secondary" disabled={busy} onClick={() => void send(pending.current, true)}>Retry question<Icon name="arrow" size={14} /></button>}</div></div>}
        <div ref={endRef} />
      </div>
      <form className="company-chat-input" onSubmit={event => { event.preventDefault(); void send(input) }}><input ref={inputRef} aria-label="Search company source files" placeholder="Ask about a number, a source, a gap…" value={input} onChange={event => { setInput(event.target.value); saveChatDraft(dealId, 'sources', event.target.value) }} maxLength={4000} readOnly={busy} disabled={!dealId} /><button className="icon-button" type="submit" aria-label="Send source question" disabled={!dealId || !input.trim() || busy}><Icon name={busy ? 'loading' : 'send'} size={19} /></button></form>
      <div className="company-chat-footer"><span>Current question · company-scoped search · original source quotations preserved</span></div>
    </>}
  </Dialog>
}
