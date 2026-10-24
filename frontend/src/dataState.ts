export type DataState = 'missing' | 'verify' | 'conflict'
export type DataStateInput = {
  conflictNumbers?: boolean
  status?: string
  normalizationStatus?: string | null
  value?: string | null
  rawValue?: string | null
  hasEvidence?: boolean
}

const present = (value: string | null | undefined): boolean => typeof value === 'string' && value.trim().length > 0

/** Presentation state only. Verify means review the evidence, not verified truth. */
export function dataState(input: DataStateInput): DataState {
  if (input.conflictNumbers === true) return 'conflict'
  const hasValue = present(input.value)
  if (input.normalizationStatus?.trim().toLowerCase() === 'missing' || input.hasEvidence === false) return 'missing'
  if (['insufficient_data', 'not_applicable'].includes(input.status?.trim().toLowerCase() ?? '') && !hasValue) return 'missing'
  if (!(input.hasEvidence ?? (hasValue || present(input.rawValue)))) return 'missing'
  return 'verify'
}

export function dataStateLabel(state: DataState): 'Missing' | 'Verify' | 'Conflict' {
  return { missing: 'Missing', verify: 'Verify', conflict: 'Conflict' }[state] as 'Missing' | 'Verify' | 'Conflict'
}

export function stateDescription(state: DataState): string {
  return {
    missing: 'Required data or a usable calculation result is missing. No value is inferred.',
    verify: 'Source evidence is available. Verify its meaning, scope and source; this label does not mean it has been verified.',
    conflict: 'Comparable recorded values disagree. Review the original values and their sources.',
  }[state]
}
