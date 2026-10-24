import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MODULES } from './data'
import type { ModuleId } from './data'
import type { CompanyReport } from './backend'
import { apiFetch, reportEvidence } from './backend'
import type { Project, Workspace } from './domain'
import { generatedDraftToSections } from './domain'
import { migrateStoredEnglish, needsStoredEnglish } from './english'

/** Refresh only translations of known saved passages, never regenerate the working report. */
export function useEnglishWorkspace(project: Project, report: CompanyReport | null, workspace: Workspace,
  setWorkspace: Dispatch<SetStateAction<Workspace>>, notify: (message: string) => void) {
  useEffect(() => {
    if (!report || !needsStoredEnglish(workspace, (report.stored_reports ?? []).map(item => item.id))) return
    const draftId = workspace.backendDraftId!
    const controller = new AbortController()
    let active = true
    async function translate() {
      try {
        const response = await apiFetch(`/deals/${encodeURIComponent(report!.company.deal_id)}/stored-reports/${encodeURIComponent(draftId)}/draft`,
          { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
        if (!response.ok) throw new Error('The English saved report could not be loaded.')
        const payload = await response.json()
        if (payload.id !== draftId) throw new Error('The English saved report belongs to another draft.')
        if (!Array.isArray(payload.sections)) throw new Error('The English saved report has no supported sections.')
        const order: ModuleId[] = payload.sections.map((section: { id?: unknown }) => {
          const module = MODULES.find(item => item.id === section?.id)
          if (!module) throw new Error('The English saved report contains an unsupported section.')
          return module.id
        })
        const english = generatedDraftToSections(project, { ...workspace, order }, report!, reportEvidence(report!), payload)
        const translated = migrateStoredEnglish(workspace, english, draftId, new Date().toISOString(), payload.translation)
        if (!active || controller.signal.aborted) return
        setWorkspace(current => current === workspace ? translated : current)
      } catch {
        if (active && !controller.signal.aborted) notify('The English saved report could not be loaded. Your draft, edits and original sources are preserved.')
      }
    }
    void translate()
    return () => { active = false; controller.abort() }
  }, [project, report, workspace, setWorkspace, notify])
}
