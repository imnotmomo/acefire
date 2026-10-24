import type { SharedUploadJob, UploadJob, UploadProvider, UploadStatus } from './workspaceApi'

export type UploadHistoryEntry = {
  clientId: string; dealId: string; name: string; size: number | null; type: string; provider: UploadProvider;
  added: string; status: UploadStatus | 'uploading'; serverId?: string; warnings: string[];
  error?: string; pollError?: string; snapshotId?: string; observations?: number; claims?: number;
  legacyId?: string; remoteOnly?: boolean; sha256?: string;
}

export function applyUploadReceipt(local: UploadHistoryEntry, result: UploadJob): UploadHistoryEntry {
  return { ...local, status: result.status, serverId: result.id, warnings: result.warnings,
    error: result.error, pollError: undefined, snapshotId: result.snapshot_id ?? local.snapshotId,
    observations: result.observations, claims: result.claims, sha256: result.sha256 ?? local.sha256 }
}

/** Preserve browser receipt/cache identities and updates made while a list request was pending. */
export function mergeUploadReceipts(current: UploadHistoryEntry[], remote: SharedUploadJob[], dealId: string, baseline: UploadHistoryEntry[] = current): UploadHistoryEntry[] {
  const localServerIds = new Set(current.filter(job => job.dealId === dealId && !job.remoteOnly && job.serverId).map(job => job.serverId))
  const previous = new Map(baseline.map(job => [job.clientId, job]))
  const receipts = new Map(remote.filter(job => job.deal_id === dealId).map(job => [job.id, job]))
  const seen = new Set<string>()
  const merged = current.filter(job => job.dealId === dealId && !(job.remoteOnly && job.serverId && localServerIds.has(job.serverId))).map(job => {
    if (job.serverId) seen.add(job.serverId)
    const receipt = job.serverId ? receipts.get(job.serverId) : undefined
    return receipt && previous.get(job.clientId) === job ? applyUploadReceipt(job, receipt) : job
  })
  for (const receipt of remote) {
    if (receipt.deal_id !== dealId || seen.has(receipt.id)) continue
    seen.add(receipt.id)
    merged.push({ clientId: `server:${receipt.id}`, dealId, serverId: receipt.id, remoteOnly: true,
      name: receipt.filename, size: null, type: 'application/octet-stream', provider: 'uploaded',
      added: receipt.created_at, status: receipt.status, warnings: receipt.warnings, error: receipt.error,
      snapshotId: receipt.snapshot_id, sha256: receipt.sha256, observations: receipt.observations, claims: receipt.claims })
  }
  return merged
}
