import type { Project } from './domain'
import { Badge, Dialog, Icon } from './ui'
import { companyChatPath } from './workspaceRoute'

type Props = { project: Project; page: string; stage?: string; navigate: (path: string) => void; onClose: () => void; onConnect: (project: Project) => Promise<void>; connecting: boolean; connectionError?: string }

/** An unconnected workspace must never impersonate the live company assistant. */
export default function Chat({ project, page, stage, navigate, onClose, onConnect, connecting, connectionError }: Props) {
  const historical = project.id === 'enfuce'
  return <Dialog title="Connect company chat" subtitle={`${project.name} / ${page}`} onClose={onClose} className="company-chat-dialog">
    <div className="company-chat-context"><div><Icon name="link" size={17} /><strong>{historical ? 'Historical workspace' : 'Company connection needed'}</strong><Badge tone="amber">Not connected</Badge></div></div>
    <div className="dialog-body"><div className="company-chat-welcome">
      <span className="company-chat-mark"><Icon name="chat" size={25} /></span>
      <h3>{historical ? 'Open the live Enfuce company chat' : 'Ask your company’s evidence'}</h3>
      {historical ? <>
        <p>This workspace contains the historical workbook and FDD snapshot. Live model chat is available in the separate Enfuce · Document claims workspace, using its imported April 2020 deck evidence.</p>
        <p>Your historical drafts and files stay here. They are not included in that company’s chat.</p>
        <a className="button primary" href={`#${companyChatPath('enfuce-documents', page, stage)}`} onClick={event => { event.preventDefault(); onClose(); navigate(companyChatPath('enfuce-documents', page, stage)) }}>Open Enfuce company chat<Icon name="arrow" size={15} /></a>
      </> : <>
        <p>Connect this project to a shared company workspace, then upload its evidence. Company chat will use that company’s stored files, calculations and reports, with source citations.</p>
        <p>Your existing drafts and browser files are preserved. Local files join the company evidence only when you upload them.</p>
        {connectionError && <p className="form-error" role="alert">{connectionError} Your project is preserved; retry the connection when the service is available.</p>}
        <button className="button primary" disabled={connecting} onClick={() => { void onConnect(project) }}><Icon name={connecting ? 'loading' : 'link'} size={15} />{connecting ? 'Connecting…' : 'Connect company workspace'}</button>
      </>}
    </div></div>
  </Dialog>
}
