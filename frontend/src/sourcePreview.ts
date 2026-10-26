import type { BackendSource } from './backend'

export type WorkbookPreview = {
  snapshot_id: string; sha256: string; sheet: string; sheets: string[]; focus_cell: string | null;
  columns: string[]; rows: { number: number; cells: { address: string; value: string | null; formula: string | null; selected: boolean }[] }[];
  row_start: number; max_row: number; column_start: number; max_column: number;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown, maximum: number): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum
const nullableText = (value: unknown) => value === null || typeof value === 'string'

export function workbookColumn(number: number): string {
  let name = ''
  while (number > 0) { number--; name = String.fromCharCode(65 + number % 26) + name; number = Math.floor(number / 26) }
  return name
}

/** Normalize a cell/range anchor without executing spreadsheet content. */
export function workbookCell(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})(?::\$?[A-Z]{1,3}\$?[1-9][0-9]{0,6})?$/i.exec(value.trim())
  if (!match) return null
  const letters = match[1].toUpperCase(), row = Number(match[2])
  const column = [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
  return row <= 1048576 && column <= 16384 ? `${letters}${row}` : null
}

/** A malformed preview is an error view, never a render crash or foreign file. */
export function parseWorkbookPreview(value: unknown, source: Pick<BackendSource, 'snapshot_id' | 'sha256'>): WorkbookPreview {
  const invalid = (): never => { throw new Error('The workbook preview is incomplete or belongs to a different evidence version. Retry or download the original file.') }
  if (!object(value) || value.snapshot_id !== source.snapshot_id || value.sha256 !== source.sha256
    || typeof value.sheet !== 'string' || !Array.isArray(value.sheets) || !value.sheets.length || value.sheets.length > 2000
    || !value.sheets.every(sheet => typeof sheet === 'string' && sheet.length > 0 && sheet.length <= 2000)
    || !value.sheets.includes(value.sheet) || new Set(value.sheets).size !== value.sheets.length
    || !positive(value.row_start, 1048576) || !positive(value.max_row, 1048576) || value.row_start > value.max_row
    || !positive(value.column_start, 16384) || !positive(value.max_column, 16384) || value.column_start > value.max_column
    || !nullableText(value.focus_cell) || value.focus_cell !== null && workbookCell(value.focus_cell) !== value.focus_cell
    || !Array.isArray(value.columns) || !value.columns.length || value.columns.length > 16
    || value.columns.some((name, index) => name !== workbookColumn((value.column_start as number) + index))
    || Number(value.column_start) + value.columns.length - 1 > Number(value.max_column)
    || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 50) return invalid()
  for (const [index, row] of value.rows.entries()) {
    if (!object(row) || row.number !== Number(value.row_start) + index || Number(row.number) > Number(value.max_row)
      || !Array.isArray(row.cells) || row.cells.length !== value.columns.length) return invalid()
    for (const [column, cell] of row.cells.entries()) {
      if (!object(cell) || cell.address !== `${value.columns[column]}${row.number}` || !nullableText(cell.value) || !nullableText(cell.formula)
        || typeof cell.selected !== 'boolean' || cell.selected !== (cell.address === value.focus_cell)) return invalid()
    }
  }
  return value as unknown as WorkbookPreview
}
