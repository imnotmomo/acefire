import type { Project } from './domain'
import type { WorkspaceCompany } from './workspaceApi'
import { parseCompanyLogo } from './companyLogoApi.ts'

const aliases = new Map([['circle-2025-ipo', 'circle'], ['enfuce-2020', 'enfuce-documents']])
const knownDeals = new Map([['circle', 'circle-2025-ipo'], ['enfuce-documents', 'enfuce-2020']])
const text = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback
export type PendingCompanyConnection = { projectId: string; dealId: string; name: string; sector: string; geography: string }
export const pendingConnectionKey = (projectId: string) => `ingenium:pending-company-connection:v1:${encodeURIComponent(projectId)}`

function companyLogoFields(company: WorkspaceCompany): Pick<Project, 'companyLogo'> {
  try { const logo = parseCompanyLogo(company.company_logo, company.deal_id); return logo ? { companyLogo: logo } : {} } catch { return {} }
}

export function companyProject(company: WorkspaceCompany): Project {
  return { id: aliases.get(company.deal_id) ?? company.deal_id, backendDealId: company.deal_id,
    name: text(company.identifiers?.workspace_display_name, company.legal_name),
    sector: text(company.identifiers?.workspace_sector ?? company.sector, 'Other'),
    geography: text(company.identifiers?.workspace_geography ?? company.geography ?? company.country, 'Unknown'),
    created: text(company.identifiers?.workspace_created_at ?? company.created_at, ''),
    ...companyLogoFields(company) }
}

/** Add shared companies while retaining browser project IDs, human labels and historical fixtures. */
export function mergeCompanyProjects(projects: Project[], companies: WorkspaceCompany[]): Project[] {
  const result = [...projects]
  for (const company of companies) {
    const canonical = companyProject(company)
    const index = result.findIndex(project => project.backendDealId === company.deal_id
      || project.id === company.deal_id || knownDeals.get(project.id) === company.deal_id)
    if (index === -1) result.push(canonical)
    else {
      const existing = result[index]
      result[index] = { ...canonical, ...existing, backendDealId: company.deal_id,
        name: company.identifiers?.workspace_display_name ? canonical.name : text(existing.name, canonical.name),
        sector: company.identifiers?.workspace_display_name ? canonical.sector : text(existing.sector, canonical.sector),
        geography: company.identifiers?.workspace_display_name ? canonical.geography : text(existing.geography, canonical.geography), created: text(existing.created, canonical.created), companyLogo: canonical.companyLogo }
    }
  }
  return result
}

/** Explicit connection keeps workspace/document storage keys and original draft content unchanged. */
export function connectLocalProject(project: Project, company: WorkspaceCompany): Project {
  return { ...project, backendDealId: company.deal_id, ...companyLogoFields(company) }
}

/** Recover a confirmed company after its previous create response was interrupted. */
export function recoverProjectConnections(projects: Project[], companies: WorkspaceCompany[], pending: PendingCompanyConnection[]): Project[] {
  return projects.map(project => {
    if (project.id === 'enfuce' || project.backendDealId) return project
    const request = pending.find(item => item.projectId === project.id && item.name === project.name
      && item.sector === project.sector && item.geography === project.geography && /^deal-[a-z0-9-]+$/.test(item.dealId))
    const company = request && companies.find(item => item.deal_id === request.dealId && item.legal_name === request.name
      && (item.identifiers?.workspace_sector ?? item.sector) === request.sector
      && (item.identifiers?.workspace_geography ?? item.geography ?? item.country) === request.geography)
    return company ? connectLocalProject(project, company) : project
  })
}

export function readProjects(value: unknown, initial: Project[]): Project[] {
  if (!Array.isArray(value)) return initial.map(project => ({ ...project }))
  const ids = new Set<string>()
  const projects = value.flatMap(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.includes('/') || typeof item.name !== 'string' || !item.name.trim() || ids.has(item.id)) return []
    ids.add(item.id)
    const backendDealId = typeof item.backendDealId === 'string' && item.backendDealId && !item.backendDealId.includes('/') ? item.backendDealId : undefined
    return [{ id: item.id, name: item.name, sector: text(item.sector, 'Other'), geography: text(item.geography, 'Unknown'),
      created: text(item.created, ''), ...(backendDealId ? { backendDealId } : {}) }]
  })
  // The imported Enfuce workspace is distinct from the historical Enfuce fixture.
  const imported = initial.find(project => project.id === 'enfuce-documents')
  return imported && !projects.some(project => project.id === imported.id) ? [...projects, { ...imported }] : projects
}
