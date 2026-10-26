import { useEffect, useState } from 'react'
import type { BackendSource } from './backend'
import { apiFetch, formatLocator } from './backend'
import { loadSourceFile, sourceFileKind } from './sourceFile'
import PdfSourcePreview from './PdfSourcePreview'
import { parseWorkbookPreview, workbookCell } from './sourcePreview'
import type { WorkbookPreview } from './sourcePreview'
import SourceFileButton from './SourceFileButton'
import { Icon } from './ui'
import './source-preview.css'

export default function SourceFilePreview({ source }: { source: BackendSource }) {
  const kind = sourceFileKind(source.file_name)
  const [url, setUrl] = useState(''); const [text, setText] = useState('')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<WorkbookPreview | null>(null)
  const [sheet, setSheet] = useState(typeof source.locator?.sheet === 'string' ? source.locator.sheet : '')
  const [row, setRow] = useState<number | null>(null)
  const [column, setColumn] = useState<number | null>(null)
  const [focusCell, setFocusCell] = useState(() => workbookCell(source.locator?.cell))
  const [cellInput, setCellInput] = useState(() => workbookCell(source.locator?.cell) ?? '')
  const [cellError, setCellError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = ''
    setLoading(true); setError(''); setUrl(''); setText(''); setBook(null)
    async function load() {
      try {
        if (kind === 'workbook') {
          const params = new URLSearchParams()
          if (sheet) params.set('sheet', sheet)
          if (focusCell) params.set('cell', focusCell)
          if (row !== null) params.set('row_start', String(row))
          if (column !== null) params.set('column_start', String(column))
          const response = await apiFetch(`/sources/${encodeURIComponent(source.snapshot_id)}/preview?${params}`, { signal: controller.signal })
          if (!response.ok) throw new Error('The workbook preview could not be loaded. You can still download the original file.')
          if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The workbook service did not return a readable preview. Retry or download the original.')
          const result = parseWorkbookPreview(await response.json(), source)
          if (!controller.signal.aborted) setBook(result)
        } else if (kind !== 'download' && kind !== 'pdf') {
          const blob = await loadSourceFile(source, controller.signal)
          if (controller.signal.aborted) return
          if (kind === 'text') {
            const original = await blob.text()
            if (!controller.signal.aborted) setText(original.length > 200_000 ? `${original.slice(0, 200_000)}\n[Preview shortened. Download the complete original.]` : original)
          } else {
            objectUrl = URL.createObjectURL(blob)
            if (!controller.signal.aborted) setUrl(objectUrl)
          }
        }
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'The source preview could not be opened.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [source, sheet, row, column, focusCell, kind, attempt])
  return <section className="source-preview" aria-label="Original source file">
    <div className="source-preview-heading"><div><strong>{source.file_name}</strong><span>{formatLocator(source.locator)}</span></div><div className="source-preview-actions"><SourceFileButton source={source} />{url && kind !== 'download' && <a className="button secondary" href={url} target="_blank" rel="noopener noreferrer">Open in new tab<Icon name="outward" size={14} /></a>}</div></div>
    {loading ? <div className="source-preview-message" role="status"><Icon name="loading" />Opening the cited source…</div> : error ? <div className="source-preview-message" role="alert"><span>{error}</span><button className="button secondary" onClick={() => setAttempt(value => value + 1)}>Retry preview<Icon name="history" size={14} /></button></div>
      : kind === 'pdf' ? <PdfSourcePreview key={`${source.snapshot_id}:${source.sha256}:${JSON.stringify(source.locator)}`} source={source} />
      : kind === 'image' ? <div className="source-preview-image"><img src={url} alt={`Original source: ${source.file_name}`} onError={() => setError('This original could not be displayed as an image. Download it to inspect its exact bytes.')} /></div>
      : kind === 'text' ? <pre className="source-preview-text">{text}</pre>
      : kind === 'workbook' && book ? <><div className="source-workbook-tools"><label>Worksheet<select aria-label="Source worksheet" value={book.sheet} onChange={e => { setSheet(e.target.value); setRow(null); setColumn(null); setFocusCell(null); setCellInput(''); setCellError('') }}>{book.sheets.map(name => <option key={name}>{name}</option>)}</select></label><form className="source-cell-jump" onSubmit={event => { event.preventDefault(); const cell = workbookCell(cellInput); if (!cell) { setCellError('Enter an Excel cell from A1 to XFD1048576.'); return }; setCellError(''); setFocusCell(cell); setRow(null); setColumn(null); setAttempt(value => value + 1) }}><label>Go to cell<input aria-label="Go to source cell" value={cellInput} onChange={event => { setCellInput(event.target.value); setCellError('') }} placeholder="e.g. AF49" aria-invalid={Boolean(cellError)} /></label><button className="button secondary" type="submit">Go</button></form><span>Original cached values · formulas are not executed</span></div>{cellError && <p className="form-error" role="alert">{cellError}</p>}<div className="source-workbook-scroll"><table><thead><tr><th></th>{book.columns.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{book.rows.map(item => <tr key={item.number}><th>{item.number}</th>{item.cells.map(cell => <td key={cell.address} className={cell.selected ? 'cited-cell' : ''} title={`${cell.address}${cell.formula ? ` · Formula: ${cell.formula}` : ''}`} data-cell={cell.address}>{cell.value ?? (cell.formula ? `=${cell.formula}` : '')}</td>)}</tr>)}</tbody></table></div><div className="source-workbook-pagination"><button className="button secondary" disabled={book.row_start <= 1} onClick={() => setRow(Math.max(1, book.row_start - 50))}>Previous rows</button><span>Rows {book.row_start}–{book.rows.at(-1)?.number} · {book.max_row} in source</span><button className="button secondary" disabled={(book.rows.at(-1)?.number ?? 0) >= book.max_row} onClick={() => setRow(book.row_start + 50)}>Next rows</button></div><div className="source-workbook-pagination"><button className="button secondary" disabled={book.column_start <= 1} onClick={() => setColumn(Math.max(1, book.column_start - 16))}>Previous columns</button><span>Columns {book.columns[0]}–{book.columns.at(-1)} · {book.max_column} in source</span><button className="button secondary" disabled={book.column_start + book.columns.length - 1 >= book.max_column} onClick={() => setColumn(book.column_start + 16)}>Next columns</button></div></>
      : <div className="source-preview-message">This file opens in its native application. Use Download original to open the exact cited file.</div>}
  </section>
}
