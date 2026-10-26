import type { Workspace } from './domain'

/** Include settings and source bindings, not just the visible text, in race checks. */
export function reportWorkspaceSignature(workspace: Workspace): string {
  return JSON.stringify(workspace)
}

export function assertReportOperationCurrent(requested: Workspace, current: Workspace, requestedReportId?: string, currentReportId?: string): void {
  if (requestedReportId !== currentReportId) throw new Error('Company evidence changed while the report request was running. Refresh evidence before trying again.')
  if (reportWorkspaceSignature(requested) !== reportWorkspaceSignature(current)) throw new Error('Your draft or report settings changed while the request was running. Those changes are preserved; start the request again when ready.')
}

/** Derive a useful basename even for company names outside the Latin alphabet. */
export function reportFilename(name: string): string {
  const basename = name.normalize('NFKC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/[.\s]+$/g, '').trim().slice(0, 120)
  return `${basename || 'company'}-diligence-report`
}
