import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { jsPDF } from 'jspdf'
import SourceFilePreview from '../../src/SourceFilePreview'
import { setApiAccessTokenProvider } from '../../src/backend'
import type { BackendSource } from '../../src/backend'
import '../../src/styles.css'
import '../../src/motion.css'

// Synthetic documents only. These pages are not company evidence or backend rendering tests.
const original = new jsPDF()
for (let number = 1; number <= 3; number++) {
  if (number > 1) original.addPage()
  original.setFontSize(20); original.text(`SYNTHETIC SOURCE PAGE ${number}`, 20, 25)
  original.setFontSize(12); original.text('Original source amount: 9007199254740993.1250 USD', 20, 50)
  original.text('Source period: January through March 2024.', 20, 65)
}
const bytes = new Uint8Array(original.output('arraybuffer'))
const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
function source(id: string, page: number): BackendSource {
  return { snapshot_id: id, file_name: `${id}.pdf`, sha256, provider: 'fixture_upload', ingestion_channel: 'user_upload', data_role: 'supplemental_evidence', visibility: 'deal_private', preview_url: `/sources/${id}/file`, locator: { kind: 'pdf_page', page } }
}
setApiAccessTokenProvider(async () => 'fixture-pdf-access-token')
async function png(page: number, id: string) {
  await document.fonts.ready
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 1600
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#273345'; context.font = 'bold 42px "Manrope Variable", sans-serif'
  context.fillText('SYNTHETIC SOURCE PAGE ' + page, 85, 120)
  context.font = '25px "Manrope Variable", sans-serif'; context.fillText(id, 85, 170)
  context.fillStyle = '#657184'; context.fillText('Read-only original source preview fixture', 85, 220)
  context.fillStyle = '#273345'; context.font = '32px "Manrope Variable", sans-serif'
  context.fillText('Original source amount', 85, 340)
  context.font = 'bold 36px "Manrope Variable", sans-serif'; context.fillText('9007199254740993.1250 USD', 85, 405)
  context.font = '27px "Manrope Variable", sans-serif'; context.fillText('Source period: January through March 2024.', 85, 500)
  context.fillText('Only this selected page is returned by the fixture API.', 85, 560)
  context.strokeStyle = '#dfe4eb'; context.beginPath(); context.moveTo(85, 620); context.lineTo(1195, 620); context.stroke()
  context.fillStyle = '#657184'; context.font = '24px "Manrope Variable", sans-serif'; context.fillText('No live API, PDF scripts, hyperlinks, forms or model calls.', 85, 690)
  return { width: canvas.width, height: canvas.height, png_base64: canvas.toDataURL('image/png').split(',')[1] }
}
function Fixture() {
  const [selected, setSelected] = useState(source('pdf-source-a', 2)), [open, setOpen] = useState(true)
  Object.assign(window, { pdfPreviewFixture: { sha256, original: Array.from(bytes), png, showSource: (id: string, page: number) => setSelected(source(id, page)), hide: () => setOpen(false), show: () => setOpen(true) } })
  return <main style={{ maxWidth: 1150, margin: '0 auto', padding: 20 }}><h1>Original PDF source</h1><p>Standalone viewer fixture with synthetic source text.</p>{open ? <SourceFilePreview source={selected} /> : <p>Preview closed.</p>}</main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
