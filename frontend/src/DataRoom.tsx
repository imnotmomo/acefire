import { useEffect, useRef, useState } from 'react'
import { EVIDENCE } from './data'
import type { LocalDocument, Project } from './domain'
import { readBlob, readLocal, safeUrl, saveBlob, saveLocal } from './domain'
import { Badge, Dialog, Empty, Icon } from './ui'
import { downloadBlob } from './export'

const CATEGORIES = ['All sources', 'Documents', 'Financial data', 'External sources', 'Images / Video']
export default function DataRoom({ project, inspect, notify }: { project: Project; inspect: (id: string) => void; notify: (message: string) => void }) {
  const key = `acefire:documents:v1:${project.id}`
  const [documents, setDocuments] = useState<LocalDocument[]>(() => readLocal(key, []))
  const [category, setCategory] = useState('All sources')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [linkName, setLinkName] = useState('')
  const [linkError, setLinkError] = useState('')
  const [viewer, setViewer] = useState<{ document: LocalDocument; blob: Blob; objectUrl: string; text?: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<LocalDocument | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seeded = project.id === 'enfuce' ? ['income', 'gross', 'company'] : []
  useEffect(() => { if (!saveLocal(key, documents)) notify('Document metadata could not be saved. Browser storage may be full.') }, [key, documents, notify])
  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.objectUrl) }, [viewer])

  async function upload(files: FileList | File[] | null) {
    if (!files?.length) return
    setUploading(true)
    const added: LocalDocument[] = []
    let failed = 0
    for (const file of Array.from(files)) {
      const id = crypto.randomUUID()
      try {
        await saveBlob(id, file)
        const ext = file.name.split('.').pop()?.toLowerCase()
        const media = file.type.startsWith('image/') || file.type.startsWith('video/')
        added.push({ id, projectId: project.id, name: file.name, type: file.type, size: file.size, added: new Date().toISOString(), category: media ? 'Images / Video' : ['xlsx', 'xls', 'csv', 'tsv'].includes(ext ?? '') ? 'Financial data' : 'Documents' })
      } catch { failed++ }
    }
    setDocuments(previous => [...previous, ...added])
    notify(`${added.length} file${added.length === 1 ? '' : 's'} saved locally.${failed ? ` ${failed} could not be stored; check browser storage.` : ' Extraction is not connected yet.'}`)
    setUploading(false)
    if (inputRef.current) inputRef.current.value = ''
  }
  async function openDocument(document: LocalDocument) {
    if (document.url) { window.open(document.url, '_blank', 'noopener,noreferrer'); return }
    try {
      const blob = await readBlob(document.id)
      if (!blob) { notify('Local file data is missing. Re-upload this file to restore it.'); return }
      const isText = /\.(txt|csv|tsv|md|json)$/i.test(document.name)
      setViewer({ document, blob, objectUrl: URL.createObjectURL(blob), text: isText ? (await blob.text()).slice(0, 100000) : undefined })
    } catch { notify('This browser could not read the saved file.') }
  }
  const matches = (name: string, itemCategory: string) => name.toLowerCase().includes(search.toLowerCase()) && (category === 'All sources' || category === itemCategory)
  const filteredSeeded = seeded.filter(id => { const item = EVIDENCE.find(e => e.id === id)!; return matches(item.file, item.category) })
  const filtered = documents.filter(item => matches(item.name, item.category))
  return <><div className="page-heading"><div><div className="heading-line"><h1>Data room</h1><Badge>{seeded.length + documents.length} sources</Badge></div></div><div className="heading-actions"><button className="button secondary" onClick={() => setLinkOpen(true)}><Icon name="link" size={16} /> Add source link</button><button className="button primary" disabled={uploading} onClick={() => inputRef.current?.click()}><Icon name={uploading ? 'loading' : 'upload'} size={16} />{uploading ? 'Saving files…' : 'Upload files'}</button></div></div><input ref={inputRef} className="sr-only" type="file" multiple aria-label="Upload source files" onChange={e => upload(e.target.files)} /><div className="upload-zone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!uploading) upload(e.dataTransfer.files) }}><span className="upload-illustration"><Icon name="folderOpen" size={33} /><span><Icon name="plus" size={12} /></span></span><div><h3>Your evidence starts here.</h3><p>Drop documents, spreadsheets, images or video. <button className="inline-button" disabled={uploading} onClick={() => inputRef.current?.click()}>Browse files</button></p><small>Files stay in this browser. New uploads are not yet extracted or added to report evidence.</small></div><Icon name="shield" size={24} /></div><div className="sources-toolbar"><div className="source-tabs" aria-label="Source categories">{CATEGORIES.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-field compact"><Icon name="search" size={15} /><input aria-label="Search sources" placeholder="Search sources…" value={search} onChange={e => setSearch(e.target.value)} /></label></div><div className="sources-table-wrap">{filteredSeeded.length + filtered.length === 0 ? <Empty icon="search" title={search ? 'No matching sources' : 'No sources here yet'} text={search ? 'Try another file name or category.' : 'Add a file or source link to start your data room.'} /> : <div className="table-scroll"><table className="sources-table"><thead><tr><th>Source name</th><th>Category</th><th>Evidence status</th><th>Origin</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{filteredSeeded.map(id => { const e = EVIDENCE.find(item => item.id === id)!; return <tr key={id}><td><button className="source-name" onClick={() => inspect(id)}><span className={`file-type ${e.category === 'Financial data' ? 'green' : 'purple'}`}><Icon name={e.category === 'Financial data' ? 'sheet' : 'document'} size={22} /></span><span><strong>{e.file}</strong><small>Saved excerpt · original binary not included</small></span></button></td><td>{e.category}</td><td><Badge tone="green">Snapshot available</Badge></td><td>Enfuce archive</td><td><button className="icon-button" aria-label={`View ${e.file}`} onClick={() => inspect(id)}><Icon name="outward" size={16} /></button></td></tr> })}{filtered.map(document => <tr key={document.id}><td><button className="source-name" onClick={() => openDocument(document)}><span className={`file-type ${document.category === 'Financial data' ? 'green' : 'blue'}`}><Icon name={document.url ? 'globe' : document.category === 'Financial data' ? 'sheet' : 'document'} size={22} /></span><span><strong>{document.name}</strong><small>{document.url ?? `${(document.size / 1024).toFixed(1)} KB · ${new Date(document.added).toLocaleDateString('en-US')}`}</small></span></button></td><td>{document.category}</td><td><Badge tone="amber">{document.url ? 'Not retrieved' : 'Not extracted'}</Badge></td><td>Local browser</td><td><button className="icon-button danger" aria-label={`Remove ${document.name}`} onClick={() => setPendingDelete(document)}><Icon name="trash" size={16} /></button></td></tr>)}</tbody></table></div>}</div><p className="data-room-footer"><Icon name="help" size={14} /> Saved extracts power the demo. Upload processing and external retrieval will connect through the backend.</p>
    {linkOpen && <Dialog title="Add an external source" subtitle="Save a link for later review. This does not retrieve or verify its content." onClose={() => setLinkOpen(false)}><form className="dialog-body" onSubmit={e => { e.preventDefault(); const valid = safeUrl(url); if (!valid) { setLinkError('Enter a valid https:// or http:// address.'); return }; setDocuments(previous => [...previous, { id: crypto.randomUUID(), projectId: project.id, name: linkName.trim() || new URL(valid).hostname, url: valid, type: 'link', size: 0, category: 'External sources', added: new Date().toISOString() }]); setLinkOpen(false); setUrl(''); setLinkName(''); setLinkError(''); notify('Source link saved locally.') }}><label>Source name<input value={linkName} onChange={e => setLinkName(e.target.value)} placeholder="e.g. Industry research" maxLength={200} /></label><label>URL<input value={url} onChange={e => { setUrl(e.target.value); setLinkError('') }} placeholder="https://…" required aria-invalid={!!linkError} aria-describedby={linkError ? 'link-error' : undefined} /></label>{linkError && <p className="form-error" id="link-error">{linkError}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setLinkOpen(false)}>Cancel</button><button className="button primary" type="submit">Save source</button></div></form></Dialog>}
    {viewer && <Dialog title={viewer.document.name} subtitle="Local source viewer · no extraction or verification performed." onClose={() => setViewer(null)} className="source-viewer"><div className="dialog-body">{viewer.text !== undefined ? <pre className="file-text-preview">{viewer.text}</pre> : viewer.document.type.startsWith('image/') ? <img className="uploaded-image" src={viewer.objectUrl} alt={viewer.document.name} /> : viewer.document.type.startsWith('video/') ? <video className="uploaded-video" src={viewer.objectUrl} controls /> : viewer.document.type === 'application/pdf' ? <iframe title={viewer.document.name} src={viewer.objectUrl} className="pdf-viewer" /> : <Empty icon="file" title="Open this file in its native application" text="A browser preview is not available for this file type." />}<button className="button secondary" onClick={() => downloadBlob(viewer.blob, viewer.document.name)}><Icon name="download" size={16} /> Download original</button></div></Dialog>}
    {pendingDelete && <Dialog title="Remove local source?" subtitle={pendingDelete.name} onClose={() => setPendingDelete(null)}><div className="dialog-body"><p>This removes the source from this project’s local list. Existing report text is unchanged.</p><div className="dialog-actions"><button className="button secondary" onClick={() => setPendingDelete(null)}>Cancel</button><button className="button destructive" onClick={() => { setDocuments(previous => previous.filter(item => item.id !== pendingDelete.id)); setPendingDelete(null); notify('Source removed from the local list.') }}>Remove source</button></div></div></Dialog>}
  </>
}
