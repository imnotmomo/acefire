"""Exercise the browser PDF writer against real text extraction, without a browser."""
import io
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which('node')
pytestmark = pytest.mark.skipif(
    NODE is None or not (ROOT / 'frontend/node_modules/jspdf').is_dir(),
    reason='PDF export integration needs Node and the installed frontend dependencies.',
)


def run_node(program):
    result = subprocess.run(
        [NODE, '--experimental-strip-types', '--input-type=module'],
        input=program.encode(), cwd=ROOT, capture_output=True, timeout=45,
    )
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    return result.stdout


def test_pdf_export_preserves_native_quotations_locators_exact_decimals_and_pagination():
    sample = ('# Unicode export fixture\n\n## Financial evidence 财务证据\n\n'
              'Source: 财务报表 · Sheet "营业收入" · Cell I49\n'
              'Exact value: 9007199254740993.1250 USD; reported €1,234.50.\n'
              'Original quotation: “原始数值不可改写。”\n\n')
    sample += '\n\n'.join(
        f'Record {number}: 原始财务证据; source sheet “营业收入”; exact decimal 9007199254740993.1250.'
        for number in range(1, 71)
    )
    output = run_node("""
import { readFile } from 'node:fs/promises'
import { createReportPdf } from './frontend/src/pdfReport.ts'
const bytes = await createReportPdf(TEXT, () => readFile('./frontend/public/fonts/IngeniumExportCJK-Regular.ttf'))
process.stdout.write(Buffer.from(bytes))
""".replace('TEXT', json.dumps(sample, ensure_ascii=False)))
    assert output.startswith(b'%PDF-')
    reader = PdfReader(io.BytesIO(output))
    assert len(reader.pages) >= 2
    extracted = '\n'.join(page.extract_text() for page in reader.pages)
    for required in ('财务报表', '营业收入', '原始数值不可改写', '9007199254740993.1250', '€1,234.50', 'Record 70'):
        assert required in extracted
    assert '?' not in extracted
    for index, page in enumerate(reader.pages, 1):
        assert f'{index} / {len(reader.pages)}' in page.extract_text()


def test_ascii_pdf_does_not_load_the_unicode_font():
    output = run_node("""
import { createReportPdf } from './frontend/src/pdfReport.ts'
const bytes = await createReportPdf('# English fixture\\n\\nExact decimal 9007199254740993.1250 USD.', async () => { throw new Error('Font loader must stay lazy') })
process.stdout.write(Buffer.from(bytes))
""")
    text = PdfReader(io.BytesIO(output)).pages[0].extract_text()
    assert 'English fixture' in text and '9007199254740993.1250' in text


def test_pdf_rejects_a_changed_font_instead_of_replacing_source_characters():
    output = run_node("""
import { createReportPdf } from './frontend/src/pdfReport.ts'
try {
  await createReportPdf('Source sheet 营业收入', async () => new Uint8Array([1,2,3]))
  throw new Error('Expected font integrity failure')
} catch (error) {
  if (!error.message.includes('integrity check')) throw error
  process.stdout.write('integrity rejection confirmed')
}
""")
    assert output == b'integrity rejection confirmed'


def test_pdf_reports_unrepresentable_characters_instead_of_silently_dropping_them():
    output = run_node("""
import { readFile } from 'node:fs/promises'
import { createReportPdf } from './frontend/src/pdfReport.ts'
try {
  await createReportPdf('Original source 🧾', () => readFile('./frontend/public/fonts/IngeniumExportCJK-Regular.ttf'))
  throw new Error('Expected explicit unsupported-character error')
} catch (error) {
  if (!error.message.includes('cannot represent') || !error.message.includes('U+1F9FE')) throw error
  process.stdout.write('unsupported character reported')
}
""")
    assert output == b'unsupported character reported'
