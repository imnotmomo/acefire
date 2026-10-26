import test from 'node:test'
import assert from 'node:assert/strict'
import { workbookCell, workbookColumn, parseWorkbookPreview } from '../src/sourcePreview.ts'

const source = { snapshot_id: 'finance', sha256: 'a'.repeat(64) }
const preview = () => ({ ...source, sheet: 'Finance', sheets: ['Finance'], focus_cell: 'AF49', column_start: 32, max_column: 32, row_start: 49, max_row: 49,
  columns: ['AF'], rows: [{ number: 49, cells: [{ address: 'AF49', value: '12345678901234567890.123456', formula: null, selected: true }] }] })

test('workbook navigation accepts source cell anchors and Excel bounds without evaluating content', () => {
  for (const [input, expected] of [['$af$49', 'AF49'], ['B2:D8', 'B2'], ['XFD1048576', 'XFD1048576']]) assert.equal(workbookCell(input), expected)
  for (const input of ['A0', 'XFE1', 'A1048577', 'Sheet!A1', '=SUM(A1)', '<script>', null]) assert.equal(workbookCell(input), null)
  assert.equal(workbookColumn(1), 'A'); assert.equal(workbookColumn(32), 'AF'); assert.equal(workbookColumn(16384), 'XFD')
})

test('workbook pages preserve exact decimals, original coordinates, formula text and selected cells', () => {
  const value = preview(); value.rows[0].cells[0].formula = 'SUM(A1:A48)'
  const parsed = parseWorkbookPreview(value, source)
  assert.equal(parsed.rows[0].cells[0].value, '12345678901234567890.123456')
  assert.equal(parsed.rows[0].cells[0].formula, 'SUM(A1:A48)')
  assert.equal(parsed.column_start, 32); assert.equal(parsed.focus_cell, 'AF49')
})

test('malformed or wrong-version workbook pages become recoverable errors instead of rendering crashes', () => {
  for (const mutate of [value => { value.sha256 = 'b'.repeat(64) }, value => { value.snapshot_id = 'foreign' },
    value => { value.rows = [null] }, value => { value.columns = [null] }, value => { value.rows[0].cells = [null] },
    value => { value.rows[0].cells[0].value = { unsafe: true } }, value => { value.rows[0].number = 2 },
    value => { value.rows[0].cells[0].address = 'A1' }, value => { value.rows[0].cells[0].selected = false },
    value => { value.column_start = 1 }, value => { value.max_column = 31 }, value => { value.sheet = 'Foreign' }, value => { value.focus_cell = 'XFE1' }]) {
    const value = preview(); mutate(value); assert.throws(() => parseWorkbookPreview(value, source), /Retry or download/)
  }
})
