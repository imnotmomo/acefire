/** Keep exact financial assumptions as strings before JSON parsing can round them. */
export function parseCalculationParameters(text: string): Record<string, unknown> {
  if (new TextEncoder().encode(text).length > 12_000) throw new Error('Calculation parameters exceed the 12 KB limit.')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('Parameters must be a valid JSON object. Keep financial amounts in quoted decimal strings.') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Parameters must be a JSON object, such as {"period_end":"2024-12-31"}.')
  // String contents are not number tokens. Inspect the original tokens, before a
  // decimal such as 1.0000000000000000001 could silently become the integer 1.
  const unquoted = text.replace(/"(?:\\.|[^"\\])*"/g, ' ')
  for (const [token] of unquoted.matchAll(/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    if (!/^-?(?:0|[1-9]\d*)$/.test(token) || !Number.isSafeInteger(Number(token))) {
      throw new Error('Use quoted decimal strings for decimal, exponential or large numeric assumptions so their exact digits are preserved.')
    }
  }
  function checkDepth(item: unknown, depth: number): void {
    if (depth > 12) throw new Error('Calculation parameters are nested too deeply; use at most 12 levels.')
    if (item && typeof item === 'object') for (const child of Object.values(item)) checkDepth(child, depth + 1)
  }
  checkDepth(value, 0)
  return value as Record<string, unknown>
}
