import type { BackendEvidence } from './backend'
import { dataState, dataStateLabel, stateDescription } from './dataState'
import type { DataState } from './dataState'
import { Icon } from './ui'

export function evidenceState(evidence: BackendEvidence): DataState {
  const record = evidence as BackendEvidence & { normalizationStatus?: string; normalizedValue?: string | null }
  const numeric = evidence.kind === 'observation'
  const value = evidence.kind === 'calculation' ? evidence.calculation?.value
    : numeric ? record.normalizedValue ?? (evidence.value === 'Unavailable' ? null : evidence.value)
    : evidence.value === 'Unavailable' ? null : evidence.excerpt
  return dataState({ conflictNumbers: evidence.conflictNumbers, status: evidence.calculation?.status,
    normalizationStatus: record.normalizationStatus, value, rawValue: evidence.rawValue,
    hasEvidence: evidence.kind === 'calculation' ? undefined : evidence.sources.length > 0 && Boolean(value || evidence.rawValue) })
}

export function ReviewStateBadge({ state }: { state: DataState }) {
  return <span className={`badge review-state review-state-${state}`} title={stateDescription(state)} aria-label={`${dataStateLabel(state)}. ${stateDescription(state)}`}><Icon name={state === 'conflict' ? 'flag' : state === 'missing' ? 'help' : 'fileCheck'} size={12} />{dataStateLabel(state)}</span>
}
