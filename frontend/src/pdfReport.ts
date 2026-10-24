const FONT_PATH = '/fonts/IngeniumExportCJK-Regular.ttf'
const FONT_SHA256 = 'a42c6aa7caf69e2ccb09b0da14e7440d8c964ddac5a75903899956fb3b4048ea'
const FONT_FILE = 'IngeniumExportCJK-Regular.ttf'
const FONT_FAMILY = 'IngeniumExportCJK'
export type PdfFontLoader = () => Promise<Uint8Array | ArrayBuffer>
let bundledFont: Promise<Uint8Array> | null = null

async function loadBundledFont(): Promise<Uint8Array> {
  if (!bundledFont) {
    bundledFont = (async () => {
      const response = await fetch(FONT_PATH, { credentials: 'omit', redirect: 'error' })
      if (!response.ok) throw new Error('The Unicode PDF font could not be loaded. Retry, or export DOCX or Markdown.')
      if (Number(response.headers.get('Content-Length')) > 16_000_000) throw new Error('The Unicode PDF font exceeds its supported size.')
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 16_000_000) throw new Error('The Unicode PDF font exceeds its supported size.')
      return bytes
    })().catch(error => { bundledFont = null; throw error })
  }
  return bundledFont
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)))
  }
  return btoa(chunks.join(''))
}

/** Create a portable report without replacing source characters or decimal strings. */
export async function createReportPdf(text: string, fontLoader: PdfFontLoader = loadBundledFont): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', putOnlyUsedFonts: true, compress: true })
  const unicode = /[^\x20-\x7e\r\n\t\u00a0-\u00ff]/u.test(text)
  if (unicode) {
    const loaded = await fontLoader()
    const bytes = new Uint8Array(loaded)
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
    if (digest !== FONT_SHA256) {
      if (fontLoader === loadBundledFont) bundledFont = null
      throw new Error('The Unicode PDF font failed its integrity check. Retry, or export DOCX or Markdown.')
    }
    pdf.addFileToVFS(FONT_FILE, base64(bytes))
    pdf.addFont(FONT_FILE, FONT_FAMILY, 'normal')
    pdf.setFont(FONT_FAMILY, 'normal')
    const metadata = pdf.getFont().metadata as { characterToGlyph?: (code: number) => number }
    if (typeof metadata.characterToGlyph !== 'function') throw new Error('The Unicode PDF font could not be registered. Use DOCX or Markdown to retain the original text.')
    const missing = [...new Set([...text].filter(character => !/\s/u.test(character)
      && (character.codePointAt(0)! > 0xffff || !metadata.characterToGlyph!(character.codePointAt(0)!))))]
    if (missing.length) throw new Error(`The PDF font cannot represent ${missing.slice(0, 5).map(character => `U+${character.codePointAt(0)!.toString(16).toUpperCase()}`).join(', ')}. Export DOCX or Markdown to retain every original character.`)
  }

  const margin = 20
  const width = pdf.internal.pageSize.getWidth() - margin * 2
  const bottom = pdf.internal.pageSize.getHeight() - 23
  let y = 22
  function newPage() { pdf.addPage(); y = 22 }
  for (const paragraph of text.split(/\r\n|\n|\r/)) {
    const heading = /^(#{1,6})\s/.exec(paragraph)
    const level = heading?.[1].length ?? 0
    const size = level === 1 ? 17 : level === 2 ? 13 : level ? 11.5 : 10
    const lineHeight = size * 0.352778 * 1.5
    pdf.setFont(unicode ? FONT_FAMILY : 'helvetica', unicode ? 'normal' : heading ? 'bold' : 'normal')
    pdf.setFontSize(size)
    pdf.setTextColor(level ? 38 : 61, level ? 48 : 67, level ? 62 : 76)
    const content = paragraph.replace(/^#{1,6}\s/, '')
    const lines: string[] = pdf.splitTextToSize(content, width)
    if (level && y > 22 && y + Math.min(lines.length, 3) * lineHeight + 12 > bottom) newPage()
    for (const line of lines) {
      if (y + lineHeight > bottom) newPage()
      pdf.text(line, margin, y)
      y += lineHeight
    }
    y += heading ? 3 : 1.8
  }
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    pdf.setFont(unicode ? FONT_FAMILY : 'helvetica', 'normal')
    pdf.setFontSize(8); pdf.setTextColor(135, 143, 153)
    pdf.text(`${page} / ${pages}`, pdf.internal.pageSize.getWidth() - margin, pdf.internal.pageSize.getHeight() - 11, { align: 'right' })
  }
  return new Uint8Array(pdf.output('arraybuffer'))
}
