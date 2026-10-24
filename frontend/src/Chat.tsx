import { useState } from 'react'
import type { Project } from './domain'
import { apiUrl, backendProjectId, formatLocator } from './backend'
import { Badge, Dialog, Icon } from './ui'

type Source = { id: string; label: number; kind: string; excerpt: string; source: { file_name: string; preview_url: string; locator: Record<string, unknown>; sha256: string } }
type Reply = { answer: string; sources: Source[]; gaps: string[]; coverage: { registered_sources: number; retrieved_chunks: number; source_gaps: { snapshot_id: string; reason: string }[] } }
type Message = { id: string; role: 'user' | 'assistant'; text: string; reply?: Reply }
export default function Chat({ project, page, onClose }: { project: Project; page: string; inspect: (id: string) => void; navigate: (path: string) => void; onClose: () => void }) {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  async function send(question: string) {
    if (!question.trim() || busy) return
    setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'user', text: question.trim() }])
    setInput('')
    setBusy(true)
    try {
      const dealId = backendProjectId(project.id) || (project.id === 'enfuce' ? 'enfuce-2020' : project.id)
      const response = await fetch(apiUrl(`/deals/${encodeURIComponent(dealId)}/chat`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: question.trim() }) })
      if (!response.ok) {
        const reason = response.status === 404 ? 'This project is not registered in the backend. Import its sources first.' : response.status === 503 ? 'The model is unavailable. Check the backend Nicrron configuration.' : 'The answer could not be validated. Please retry.'
        throw new Error(reason)
      }
      const reply: Reply = await response.json()
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', text: reply.answer, reply }])
    } catch (error) {
      setMessages(previous => [...previous, { id: crypto.randomUUID(), role: 'assistant', text: error instanceof Error ? error.message : 'Unable to reach the evidence backend.' }])
    } finally { setBusy(false) }
  }
  return <Dialog title="Ask your evidence" subtitle={`${project.name} / ${page}`} onClose={onClose} className="chat-dialog">
    <div className="chat-mode"><Badge tone="blue">Evidence bot</Badge><span>Database + registered originals · cited answers</span></div>
    <div className="chat-messages" role="log" aria-live="polite">
      {messages.length === 0 && <div className="chat-welcome"><span><Icon name="sparkles" size={26} /></span><h3>Start with a question.<br />Follow it to the evidence.</h3><p>Each factual statement links to a source. Missing evidence stays explicit.</p><div className="quick-prompts">{['收入来自哪些业务？', 'What evidence supports customer growth?', '有哪些财务数据冲突？', 'What are the evidence gaps?'].map(prompt => <button key={prompt} onClick={() => void send(prompt)}>{prompt}<Icon name="outward" size={14} /></button>)}</div></div>}
      {messages.map(message => <div key={message.id} className={`chat-message ${message.role}`}><strong>{message.role === 'assistant' ? 'Acefire' : 'You'}</strong><p style={{ whiteSpace: 'pre-wrap' }}>{message.text}</p>
        {message.reply?.sources.map(source => <details key={source.id}><summary className="citation">[{source.label}] {source.source.file_name} · {formatLocator(source.source.locator)}</summary><blockquote style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{source.excerpt}</blockquote><p>{source.kind} · SHA-256: {source.source.sha256}</p><a href={apiUrl(source.source.preview_url)} target="_blank" rel="noreferrer">Open original source</a></details>)}
        {!!message.reply?.gaps.length && <div><strong>Evidence gaps</strong>{message.reply.gaps.map((gap, index) => <p key={index}>{gap}</p>)}</div>}
        {message.reply && <details><summary>Coverage: {message.reply.coverage.retrieved_chunks} retrieved excerpts / {message.reply.coverage.registered_sources} registered sources</summary>{message.reply.coverage.source_gaps.map((gap, index) => <p key={index}>{gap.snapshot_id}: {gap.reason}</p>)}<p>Automated source-support checks do not independently verify company assertions. Search is bounded and may miss relevant evidence.</p></details>}
      </div>)}
      {busy && <p role="status">Retrieving evidence and checking citations…</p>}
    </div>
    <form className="chat-input" onSubmit={e => { e.preventDefault(); void send(input) }}><input aria-label="Ask your evidence" placeholder="Ask about a number, a source, a gap…" value={input} onChange={e => setInput(e.target.value)} maxLength={4000} disabled={busy} /><button className="icon-button" type="submit" aria-label="Send question" disabled={!input.trim() || busy}><Icon name="send" size={19} /></button></form>
    <p className="chat-footer">Current question only · company-scoped evidence · no investment conclusions</p>
  </Dialog>
}
