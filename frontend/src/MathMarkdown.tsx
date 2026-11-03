import type { ReactNode } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// Math-only Markdown for authored sample copy; ordinary text remains escaped by React.
export default function MathMarkdown({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let cursor = 0
  while (cursor < text.length) {
    const start = text.indexOf('$', cursor)
    if (start < 0) { parts.push(text.slice(cursor)); break }
    parts.push(text.slice(cursor, start))
    const delimiter = text.startsWith('$$', start) ? '$$' : '$'
    const end = text.indexOf(delimiter, start + delimiter.length)
    // During typing, wait for the closing delimiter before rendering an expression.
    if (end < 0) break
    const html = katex.renderToString(text.slice(start + delimiter.length, end).trim(), {
      displayMode: delimiter === '$$', output: 'htmlAndMathml',
      trust: false, throwOnError: false, maxExpand: 100, maxSize: 10,
    })
    parts.push(<span className={delimiter === '$$' ? 'ig-math-display' : 'ig-math-inline'} key={start} dangerouslySetInnerHTML={{ __html: html }} />)
    cursor = end + delimiter.length
  }
  return <>{parts}</>
}
