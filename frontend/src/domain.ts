import { MODULES, EVIDENCE, DEFAULT_MODULES, evidenceForModule } from './data.ts'
import type { ModuleId } from './data.ts'

export type Project = { id: string; name: string; sector: string; geography: string; created: string }
export type ModuleConfig = { topics: string[]; depth: 'Brief' | 'Standard' | 'Deep'; geography: string; horizon: string; scope: 'Internal only' | 'Internal + external'; focus: string }
export type Section = { id: ModuleId; title: string; content: string; evidenceIds: string[]; config: ModuleConfig }
export type Revision = { id: string; at: string; section: ModuleId; title: string; before: string; after: string; author: string }
export type Workspace = { order: ModuleId[]; configs: Partial<Record<ModuleId, ModuleConfig>>; sections: Section[]; revisions: Revision[]; generatedAt: string | null }
export type LocalDocument = { id: string; projectId: string; name: string; type: string; size: number; category: string; added: string; url?: string }

export const ENFUCE: Project = { id: 'enfuce', name: 'Enfuce', sector: 'Fintech', geography: 'Finland', created: '2026-10-24T12:00:00Z' }
export function defaultConfig(id: ModuleId): ModuleConfig {
  const module = MODULES.find(m => m.id === id)!
  return { topics: module.topics.slice(0, id === 'market' ? 5 : 3), depth: 'Standard', geography: id === 'market' ? 'Europe' : 'Global', horizon: 'Source period', scope: 'Internal only', focus: '' }
}
export function emptyWorkspace(): Workspace {
  return { order: [...DEFAULT_MODULES], configs: {}, sections: [], revisions: [], generatedAt: null }
}
export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return [...items]
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

const PARAGRAPHS: Record<string, string> = {
  company: 'The historical FDD describes Enfuce as a financial technology company founded in 2016 and headquartered in Finland, with payment services as its primary business. This is the source’s description, not a current independently verified profile. [company]',
  income: 'H1 2020 group operating income totals €3,452,682.81: €3,417,663.76 in revenue plus €35,019.05 in other operating income. The saved worksheet values reproduce this arithmetic. [income]',
  definition: 'The summary’s “营业收入” figure corresponds numerically to total operating income, rather than pure revenue. Confirm the report’s revenue definition before making a direct comparison. [definition]',
  gross: 'The 2019 gross profit formula reproduces 3,609.32824 kEUR: 5,095.50635 − 1,536.17811 + 50. The additional 50 kEUR is an unlabeled constant; its business meaning needs clarification. [gross]',
  mrr: 'The MRR worksheet’s Q-column total is €366,559.95, displayed as 367 kEUR after the source number format is applied. ARR is not calculated: the recurring revenue definition, customer scope and as-of date need confirmation. [mrr]',
  rounding: 'Reported 2019 revenue of 5,096 kEUR is numerically consistent with the workbook’s 5,095.50635 kEUR after rounding. Entity scope remains unresolved, so this is not a final matched comparison. [rounding]',
  customers: 'The historical FDD reports 16 customers and identifies ST1 as the largest. No customer-level reconciliation is available in this snapshot; treat both statements as reported only. [customers]',
}

export function generateSections(project: Project, workspace: Workspace): Section[] {
  return workspace.order.map(id => {
    const module = MODULES.find(m => m.id === id)!
    const config = workspace.configs[id] ?? defaultConfig(id)
    let ids = project.id === 'enfuce' ? [...evidenceForModule(id)] : []
    if (id === 'financials') {
      ids = ids.filter(key => (['income', 'definition', 'rounding'].includes(key) && config.topics.includes('Revenue')) || (key === 'gross' && config.topics.includes('Gross profit')) || (key === 'mrr' && config.topics.includes('Recurring revenue')))
    }
    if (id === 'overview' && !config.topics.includes('Company profile')) ids = []
    if (id === 'customers' && !config.topics.includes('Customer base')) ids = []
    if (config.topics.length === 0) ids = []
    let content = ''
    if (id === 'questions' && ids.length > 0) {
      content = ids.map(key => `${EVIDENCE.find(e => e.id === key)!.note} [${key}]`).join('\n\n')
    } else {
      content = ids.map(key => PARAGRAPHS[key]).filter(Boolean).join('\n\n')
    }
    if (!content) content = `No supporting evidence is available in this project snapshot for ${module.name.toLowerCase()}. Requested topics: ${config.topics.join(', ') || 'none selected'}. Add source material and complete extraction before drafting factual claims.`
    if (id === 'financials' && config.topics.includes('Cash & runway')) content += '\n\nCash and runway: no supporting inputs are available; these metrics cannot be calculated.'
    content += `\n\nRequested scope: ${config.depth.toLowerCase()} · ${config.geography} · ${config.horizon}.`
    if (config.focus.trim()) content += `\n\nResearch focus: ${config.focus.trim()}\nThis focus has been saved for retrieval; this local preview does not perform additional research.`
    if (config.scope === 'Internal + external') content += '\n\nExternal evidence requested. No external search has been executed in this local preview.'
    return { id, title: module.name, content, evidenceIds: ids, config: structuredClone(config) }
  })
}

export function citedEvidenceIds(sections: Section[]): string[] {
  const allowed = new Set(EVIDENCE.map(e => e.id))
  return [...new Set(sections.flatMap(s => [...s.content.matchAll(/\[([a-z]+)\]/g)].map(m => m[1])).filter(id => allowed.has(id)))]
}
export function reportMarkdown(project: Project, sections: Section[]): string {
  const sources = citedEvidenceIds(sections).map(id => {
    const e = EVIDENCE.find(item => item.id === id)!
    return `- [${id}] ${e.file} — ${e.locator}; period: ${e.period}; status: ${e.status}. ${e.note}`
  }).join('\n')
  return `# ${project.name} — Diligence report\n\nLocal evidence preview. Historical saved extracts; not live research or an investment recommendation. User edits have not been reverified.\n\n${sections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n')}\n\n## Evidence references\n\n${sources || 'No cited evidence.'}\n`
}

export function safeUrl(input: string): string | null {
  try { const url = new URL(input); return ['http:', 'https:'].includes(url.protocol) ? url.href : null } catch { return null }
}

export function readLocal<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback }
}
export function saveLocal(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true } catch { return false }
}

let dbPromise: Promise<IDBDatabase> | null = null
function openFileDb(): Promise<IDBDatabase> {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open('acefire-files', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { dbPromise = null; reject(request.error) }
  })
  return dbPromise
}
export async function saveBlob(id: string, blob: Blob): Promise<void> {
  const db = await openFileDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('files', 'readwrite')
    transaction.objectStore('files').put(blob, id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
export async function readBlob(id: string): Promise<Blob | undefined> {
  const db = await openFileDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
