/** Chat links carry an opening intent without changing the workspace's source identity. */
export function parseWorkspaceRoute(path: string) {
  const separator = path.indexOf('?')
  const pathname = separator === -1 ? path : path.slice(0, separator)
  const query = new URLSearchParams(separator === -1 ? '' : path.slice(separator + 1))
  return { pathname, parts: pathname.split('/').filter(Boolean), companyChat: query.getAll('chat').length === 1 && query.get('chat') === 'company' }
}

export function withoutCompanyChatIntent(path: string): string {
  const separator = path.indexOf('?')
  if (separator === -1) return path
  const query = new URLSearchParams(path.slice(separator + 1))
  query.delete('chat')
  const remaining = query.toString()
  return path.slice(0, separator) + (remaining ? `?${remaining}` : '')
}

export function companyChatPath(projectId: string, page: string, stage = 'build'): string {
  const destination = page === 'Dashboard' ? 'dashboard' : page === 'Data room' ? 'data-room' : `report/${['build', 'review', 'export'].includes(stage) ? stage : 'build'}`
  return `/project/${encodeURIComponent(projectId)}/${destination}?chat=company`
}
