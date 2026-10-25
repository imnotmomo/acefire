import type { Project } from './domain'

const temporaryDemoIds = new Set(['healthtech-demo', 'marketplace-demo'])

/** Undo only the temporary demo catalog; project workspaces and files are separate and untouched. */
export function rollbackProjects(projects: Project[], initialProjects: readonly Project[]): Project[] {
  const isTemporaryLocalDemo = (project: Project) => temporaryDemoIds.has(project.id) && !project.backendDealId
  if (!projects.some(isTemporaryLocalDemo)) return projects
  const retained = projects.filter(project => !isTemporaryLocalDemo(project))
  const initialIds = new Set(initialProjects.map(project => project.id))
  return [
    ...initialProjects.map(project => ({ ...project, ...retained.find(existing => existing.id === project.id) })),
    ...retained.filter(project => !initialIds.has(project.id)),
  ]
}
