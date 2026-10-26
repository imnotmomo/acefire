import type { Project, Section, ReportExportContext } from './domain'
import type { Evidence } from './data'
import { EVIDENCE } from './data'
import { reportMarkdown } from './domain'
import { reportFilename } from './reportOperations'

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name
  // Safari and embedded browsers require the download anchor to be connected.
  document.body.appendChild(link)
  try { link.click() } finally { link.remove() }
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function exportReport(format: 'Markdown' | 'PDF' | 'DOCX', project: Project, sections: Section[], evidence: Evidence[] = EVIDENCE, context: ReportExportContext = { kind: 'snapshot' }) {
  const text = reportMarkdown(project, sections, evidence, context)
  const filename = reportFilename(project.name)
  if (format === 'Markdown') return downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)
  if (format === 'PDF') {
    const { createReportPdf } = await import('./pdfReport')
    const bytes = await createReportPdf(text)
    return downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${filename}.pdf`)
  }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')
  const document = new Document({ sections: [{ children: text.split('\n').map(line => new Paragraph({
    heading: line.startsWith('## ') ? HeadingLevel.HEADING_2 : line.startsWith('# ') ? HeadingLevel.HEADING_1 : undefined,
    children: [new TextRun({ text: line.replace(/^#+\s/, ''), font: 'Calibri', size: 22 })],
    spacing: { after: 150 },
  })) }] })
  downloadBlob(await Packer.toBlob(document), `${filename}.docx`)
}
