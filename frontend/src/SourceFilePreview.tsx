import { useEffect, useState } from 'react'
import type { BackendSource } from './backend'
import { apiFetch, formatLocator } from './backend'
import { loadSourceFile, sourceFileKind, sourcePage } from './sourceFile'
import { Icon } from './ui'
import './source-preview.css'

type Workbook = { snapshot_id: string; sha256: string; sheet: string; sheets: string[]; focus_cell: string | null; columns: string[]; rows: { number: number; cells: { address: string; value: string | null; formula: string | null; selected: boolean }[] }[]; row_start: number; max_row: number; column_start: number; max_column: number }

export default function SourceFilePreview({ source }: { source: BackendSource }) {
  const kind = sourceFileKind(source.file_name)
  const [url, setUrl] = useState(''); const [text, setText] = useState('')
  const [error, setError] = useState(''); const [loading, setLoading] = useState(true)
  const [book, setBook] = useState<Workbook | null>(null)
  const [sheet, setSheet] = useState(typeof source.locator?.sheet === 'string' ? source.locator.sheet : '')
  const [row, setRow] = useState<number | null>(null)
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = ''
    setLoading(true); setError(''); setUrl(''); setText(''); setBook(null)
    async function load() {
      try {
        if (kind === 'workbook') {
          const params = new URLSearchParams()
          if (sheet) params.set('sheet', sheet)
          if (typeof source.locator?.cell === 'string' && (!sheet || sheet === source.locator.sheet)) params.set('cell', source.locator.cell)
          if (row !== null) params.set('row_start', String(row))
          const response = await apiFetch(`/sources/${encodeURIComponent(source.snapshot_id)}/preview?${params}`, { signal: controller.signal })
          if (!response.ok) throw new Error('The workbook preview could not be loaded. You can still download the original file.')
          const result = await response.json() as Workbook
          if (result.snapshot_id !== source.snapshot_id || result.sha256 !== source.sha256 || !Array.isArray(result.rows) || !Array.isArray(result.columns) || !Array.isArray(result.sheets)) throw new Error('The workbook preview belongs to a different evidence version.')
          if (!controller.signal.aborted) setBook(result)
        } else {
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
  }, [source, sheet, row, kind])
  const page = sourcePage(source)
  return <section className="source-preview" aria-label="Original source file">
    <div className="source-preview-heading"><div><strong>{source.file_name}</strong><span>{formatLocator(source.locator)}</span></div>{url && kind !== 'download' && <a className="button secondary" href={`${url}${kind === 'pdf' && page ? `#page=${page}` : ''}`} target="_blank" rel="noopener noreferrer">Open in new tab<Icon name="outward" size={14} /></a>}</div>
    {loading ? <div className="source-preview-message" role="status"><Icon name="loading" />Opening the cited source…</div> : error ? <div className="source-preview-message" role="alert">{error}</div>
      : kind === 'pdf' ? <iframe className="source-preview-pdf" title={`Original PDF: ${source.file_name}`} src={`${url}${page ? `#page=${page}` : ''}`} />
      : kind === 'image' ? <div className="source-preview-image"><img src={url} alt={`Original source: ${source.file_name}`} /></div>
      : kind === 'text' ? <pre className="source-preview-text">{text}</pre>
      : kind === 'workbook' && book ? <><div className="source-workbook-tools"><label>Worksheet<select aria-label="Source worksheet" value={book.sheet} onChange={e => { setSheet(e.target.value); setRow(null) }}>{book.sheets.map(name => <option key={name}>{name}</option>)}</select></label><span>Original cached values · formulas are not executed</span></div><div className="source-workbook-scroll"><table><thead><tr><th></th>{book.columns.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{book.rows.map(item => <tr key={item.number}><th>{item.number}</th>{item.cells.map(cell => <td key={cell.address} className={cell.selected ? 'cited-cell' : ''} title={`${cell.address}${cell.formula ? ` · Formula: ${cell.formula}` : ''}`} data-cell={cell.address}>{cell.value ?? (cell.formula ? `=${cell.formula}` : '')}</td>)}</tr>)}</tbody></table></div><div className="source-workbook-pagination"><button className="button secondary" disabled={book.row_start <= 1} onClick={() => setRow(Math.max(1, book.row_start - 50))}>Previous rows</button><span>Rows {book.row_start}–{book.rows.at(-1)?.number} · {book.max_row} in source</span><button className="button secondary" disabled={(book.rows.at(-1)?.number ?? 0) >= book.max_row} onClick={() => setRow(book.row_start + 50)}>Next rows</button></div></>
      : <div className="source-preview-message">This file opens in its native application. Use Download original to open the exact cited file.</div>}
  </section>
}
