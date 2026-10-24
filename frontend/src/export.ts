import type { Project, Section, ReportExportContext } from './domain'
import type { Evidence } from './data'
import { EVIDENCE } from './data'
import { reportMarkdown } from './domain'

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export async function exportReport(format: 'Markdown' | 'PDF' | 'DOCX', project: Project, sections: Section[], evidence: Evidence[] = EVIDENCE, context: ReportExportContext = { kind: 'snapshot' }) {
  const text = reportMarkdown(project, sections, evidence, context)
  const filename = `${project.name.replace(/[^a-z0-9-]/gi, '-')}-diligence-report`
  if (format === 'Markdown') return downloadBlob(new Blob([text], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)
  if (format === 'PDF') {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF()
    let y = 22
    // Built-in PDF fonts cover Latin; preserve non-Latin source locators in DOCX/Markdown.
    const latin = text.replace(/[^\x20-\x7e\n\u00a0-\u00ff]/g, char => ({ '€': 'EUR ', '—': '-', '–': '-', '−': '-', '·': '/' }[char] ?? '?'))
    for (const paragraph of latin.split('\n')) {
      const heading = paragraph.startsWith('#')
      pdf.setFont('helvetica', heading ? 'bold' : 'normal')
      pdf.setFontSize(heading ? 14 : 10)
      const lines: string[] = pdf.splitTextToSize(paragraph.replace(/^#+\s/, ''), 170)
      for (const line of lines) {
        if (y > 274) { pdf.addPage(); y = 22 }
        pdf.text(line, 20, y); y += heading ? 7 : 5
      }
      y += 2
    }
    pdf.save(`${filename}.pdf`)
    return
  }
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx')
  const document = new Document({ sections: [{ children: text.split('\n').map(line => new Paragraph({
    heading: line.startsWith('## ') ? HeadingLevel.HEADING_2 : line.startsWith('# ') ? HeadingLevel.HEADING_1 : undefined,
    children: [new TextRun({ text: line.replace(/^#+\s/, ''), font: 'Calibri', size: 22 })],
    spacing: { after: 150 },
  })) }] })
  downloadBlob(await Packer.toBlob(document), `${filename}.docx`)
}
