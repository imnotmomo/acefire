import type { CompanyReport } from './backend'
import { parseDocumentReply } from './documentChatState.ts'
import type { DocumentChatReply } from './documentChatState'

export const chatDraftKey = (dealId: string, channel: 'company' | 'sources') => `acefire:chat-draft:v1:${channel}:${encodeURIComponent(dealId)}`
export const documentConversationKey = (dealId: string) => `acefire:document-chat:v1:${encodeURIComponent(dealId)}`
export type DocumentMessage = { id: string; role: 'user' | 'assistant'; text: string; reply?: DocumentChatReply }
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export function readChatDraft(dealId: string | null, channel: 'company' | 'sources'): string {
  try {
    const value = dealId ? sessionStorage.getItem(chatDraftKey(dealId, channel)) : null
    return value && value.length <= 4000 ? value : ''
  } catch { return '' }
}
export function saveChatDraft(dealId: string | null, channel: 'company' | 'sources', value: string) {
  if (!dealId) return
  try {
    if (value) sessionStorage.setItem(chatDraftKey(dealId, channel), value.slice(0, 4000))
    else sessionStorage.removeItem(chatDraftKey(dealId, channel))
  } catch { /* Input stays usable when browser storage is unavailable. */ }
}

/** Keep citation identities and text, never signed file URLs or extra source metadata. */
export function encodeDocumentConversation(dealId: string, messages: DocumentMessage[]): string {
  const stored = messages.slice(-40).map(message => ({ id: message.id, role: message.role, text: message.text,
    ...(message.reply ? { reply: { ...message.reply, sources: message.reply.sources.map(item => ({ id: item.id, label: item.label, kind: item.kind, excerpt: item.excerpt,
      source: { snapshot_id: item.source.snapshot_id, file_name: item.source.file_name, sha256: item.source.sha256, provider: item.source.provider,
        ingestion_channel: item.source.ingestion_channel, data_role: item.source.data_role, visibility: item.source.visibility, locator: item.source.locator } })) } } : {}) }))
  return JSON.stringify({ version: 1, deal_id: dealId, messages: stored })
}

/** Rebind saved citations to the current registered originals before displaying them. */
export function readDocumentConversation(raw: string | null, dealId: string, report?: CompanyReport): DocumentMessage[] {
  if (!raw || raw.length > 2_000_000 || report && report.company.deal_id !== dealId) return []
  try {
    const value: unknown = JSON.parse(raw)
    if (!object(value) || value.version !== 1 || value.deal_id !== dealId || !Array.isArray(value.messages) || value.messages.length > 40) return []
    const result: DocumentMessage[] = []
    for (const item of value.messages) {
      if (!object(item) || typeof item.id !== 'string' || item.id.length > 100 || typeof item.text !== 'string' || !item.text.trim()) continue
      if (item.role === 'user' && item.text.length <= 4000) { result.push({ id: item.id, role: 'user', text: item.text }); continue }
      if (item.role !== 'assistant' || !report || !object(item.reply) || !Array.isArray(item.reply.sources)) continue
      try {
        const sources = item.reply.sources.map(citation => {
          if (!object(citation) || !object(citation.source)) throw new Error('Invalid citation')
          const snapshotId = citation.source.snapshot_id
          const registered = report.source_files.find(source => source.snapshot_id === snapshotId)
          if (!registered || registered.sha256 !== citation.source.sha256 || registered.file_name !== citation.source.file_name || registered.provider !== citation.source.provider) throw new Error('Stale source')
          return { ...citation, source: { ...citation.source, preview_url: registered.preview_url, preview_available: registered.preview_available } }
        })
        const reply = parseDocumentReply({ ...item.reply, sources }, dealId, report)
        if (item.text === reply.answer) result.push({ id: item.id, role: 'assistant', text: reply.answer, reply })
      } catch { /* A changed or unavailable source cannot revive an old factual answer. */ }
    }
    return result
  } catch { return [] }
}
