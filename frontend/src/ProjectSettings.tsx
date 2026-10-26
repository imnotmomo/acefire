import { useEffect, useRef, useState } from 'react'
import type { Project } from './domain'
import type { CompanyLabels } from './companyManagement'
import { Dialog, Icon } from './ui'

type Props = { project: Project; shared: boolean; archived: boolean; onClose: () => void; onSave: (labels: CompanyLabels, signal: AbortSignal) => Promise<void> }
export default function ProjectSettings({ project, shared, archived, onClose, onSave }: Props) {
  const [name, setName] = useState(project.name), [sector, setSector] = useState(project.sector), [geography, setGeography] = useState(project.geography)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  function close() { request.current?.abort(); onClose() }
  async function save(nextArchived = archived) {
    if (request.current) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setError('')
    try { await onSave({ display_name: name.trim(), sector: sector.trim(), geography: geography.trim(), archived: nextArchived }, controller.signal); if (!controller.signal.aborted) onClose() }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Workspace settings could not be saved.') }
    finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setBusy(false) }
  }
  return <Dialog title="Workspace settings" subtitle={shared ? 'Shared labels and archive status. Original company identity and evidence stay unchanged.' : 'This workspace is local to this browser. Connect it to share company evidence.'} onClose={close}>
    <form className="dialog-body" onSubmit={event => { event.preventDefault(); void save() }} aria-busy={busy}>
      <label>Workspace name<input value={name} maxLength={120} required disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <div className="field-pair"><label>Sector<input value={sector} maxLength={120} required disabled={busy} onChange={event => setSector(event.target.value)} /></label><label>Geography<input value={geography} maxLength={120} required disabled={busy} onChange={event => setGeography(event.target.value)} /></label></div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="preview-note">{archived ? 'Restoring puts this workspace back in the active list.' : 'Archiving hides the workspace from the active list. Its files, calculations and reports are retained and it can be restored.'}</p>
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy || !name.trim() || !sector.trim() || !geography.trim()} onClick={() => { void save(!archived) }}>{archived ? 'Restore workspace' : 'Archive workspace'}</button><button type="submit" className="button primary" disabled={busy || !name.trim() || !sector.trim() || !geography.trim()}><Icon name={busy ? 'loading' : 'check'} size={15} />{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </Dialog>
}
