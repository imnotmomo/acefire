"""Workspace uploads reuse B's quote checks and C's Decimal normalization.

Originals and the private source index stay on this machine. OCR is explicitly a
reading representation, never proof that model interpretation is correct.
"""
from __future__ import annotations
import csv
from io import StringIO
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from decimal import Decimal
from threading import RLock
from uuid import uuid4

from app.schemas import IngestionResult, stable_id
from app.intake import ExtractedClaim, ingest_b_claims
from app.document_intake import DocumentClaim, claim_id, initialize_documents, save_document_claims
from app.uploads import ingest_upload

_INDEX_LOCK = RLock()
_DOCUMENT_LOCK = RLock()
MAX_ROWS = 2000
MAX_CLAIMS = 500
SUPPORTED = {'.pdf','.docx','.pptx','.doc','.ppt','.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff','.bmp','.csv','.tsv','.xlsx','.xls','.xlsm','.txt','.md','.json'}


def upload_root():
    return Path(os.getenv('UPLOAD_CACHE_ROOT', str(Path(__file__).resolve().parents[1] / '.cache' / 'workspace-uploads'))).expanduser().resolve()


def atomic_json(path, value):
    path = Path(path);path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as output:
            os.chmod(temporary, 0o600)
            json.dump(value, output, ensure_ascii=False, sort_keys=True, allow_nan=False)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def register_sources(sources):
    root = upload_root();index = root / 'source-files.json'
    with _INDEX_LOCK:
        records = json.loads(index.read_text()) if index.exists() else {}
        for source in sources:
            if not source.local_path:
                continue
            path = Path(source.local_path).resolve()
            if not path.is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != source.sha256:
                raise ValueError('Upload original failed its private source integrity check.')
            records[source.id] = {'path':str(path),'sha256':source.sha256}
        atomic_json(index, records)


def uploaded_source_path(source):
    root = upload_root();index = root / 'source-files.json'
    if not index.is_file():return None
    with _INDEX_LOCK:
        entry = json.loads(index.read_text()).get(source.id)
    if not entry or entry.get('sha256') != source.sha256:return None
    path = Path(entry['path']).resolve()
    return path if path.is_relative_to(root) and path.is_file() else None


def persist_claims(store, company, claims):
    if hasattr(store, 'save_document_claims'):
        return store.save_document_claims(company, claims)
    initialize_documents(store)
    return save_document_claims(store, company, claims)


def quote_claim(company, source, text, locator, label):
    values = dict(deal_id=company.deal_id, entity_key=company.entity_key, snapshot_id=source.id,
        claim_type='other_nonfinancial', statement=label[:1000] or 'Source excerpt',
        evidence=[{'snapshot_id':source.id,'quote':text,'locator':locator,'quote_match_rule':'exact_original_cell_or_text_v1'}],
        model='native_source_reader',extractor_version='workspace-source-v1',limitations=['Source-reported content; identity and meaning require review.'])
    return DocumentClaim(id=claim_id(values),**values)


def table_intake(company, source, rows):
    """No guessed scale/period: explicit long-table metadata is normalized by C."""
    claims=[];packets=[];warnings=[]
    for row_number, columns, values, quote, row_locator in rows:
        if len(claims) >= MAX_CLAIMS:
            warnings.append(f'Only the first {MAX_CLAIMS} source rows/cells were extracted; the original remains available.');break
        if quote.strip():claims.append(quote_claim(company,source,quote,row_locator,f'Source row {row_number}'))
        mapped={str(k).strip().lower():str(v).strip() for k,v in zip(columns,values) if v is not None}
        if 'raw_value' in mapped and 'metric_key' in mapped:
            locator = dict(row_locator)
            if locator['kind']=='xlsx_cell':locator['cell']=locator.pop('raw_value_cell', locator['cell'])
            try:
                packet=ExtractedClaim(source_id=source.id,metric_key=mapped['metric_key'],label=mapped.get('label') or mapped['metric_key'],
                    raw_value=mapped.get('raw_value'),unit=mapped.get('unit') or None,currency=mapped.get('currency') or None,
                    scale_multiplier=mapped.get('scale_multiplier') or None,normalization_basis=mapped.get('normalization_basis') or None,
                    definition_key=mapped.get('definition_key') or None,scope=mapped.get('scope') or None,
                    accounting_basis=mapped.get('accounting_basis') or None,period_kind=mapped.get('period_kind','unknown'),
                    period_start=mapped.get('period_start') or None,period_end=mapped.get('period_end') or None,
                    period_label=mapped.get('period_label') or None,scenario=mapped.get('scenario','unknown'),
                    locator=locator,extractor_version='workspace-table-v1')
            except ValueError:
                warnings.append(f'Row {row_number} has invalid explicit metadata; its original values remain quoted for review.');continue
            packets.append(packet)
        else:
            for column, value in zip(columns, values):
                if value is None or not re.fullmatch(r'[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',str(value).strip()):continue
                location=dict(row_locator)
                if location['kind']=='csv_row':location['column']=str(column)
                elif location['kind']=='xlsx_cell':location['cell']=f'{column}{row_number}'
                key=re.sub('[^a-z0-9_]+','_',str(column).lower()).strip('_') or 'source_value'
                packets.append(ExtractedClaim(source_id=source.id,metric_key=key,label=f'{column} · row {row_number}',
                    raw_value=str(value),locator=location,extractor_version='workspace-table-v1',notes=['Unit, scale and period are not inferred from a numeric token.']))
    intake=ingest_b_claims(company,packets,[source])
    return intake,claims,list(dict.fromkeys(warnings+intake.warnings))


def csv_rows(path):
    text=path.read_text(encoding='utf-8-sig');lines=text.splitlines(keepends=True)
    reader=csv.reader(StringIO(text),delimiter='\t' if path.suffix.lower()=='.tsv' else ',')
    columns=next(reader,[])
    if not columns or len(columns)>300:raise ValueError('CSV needs a header and at most 300 columns.')
    previous=reader.line_num
    for number,values in enumerate(reader,2):
        if number>MAX_ROWS+1:raise ValueError('CSV exceeds 2000 supported records; split the source first.')
        end=reader.line_num;quote=''.join(lines[previous:end]).rstrip('\r\n');previous=end
        if len(quote)>30000:raise ValueError('CSV record exceeds the supported text size.')
        yield number,columns,values,quote,{'kind':'csv_row','row':number,'line_end':end,'extraction_basis':'csv record order; header is row 1'}


def xlsx_rows(path):
    from app.local_sources import _workbook
    from app.source_preview import cell_position, column_name
    from zipfile import ZipFile
    with ZipFile(path) as archive:
        if len(archive.infolist())>2000 or sum(i.file_size for i in archive.infolist())>50_000_000:raise ValueError('Workbook exceeds preview/extraction size limits.')
    sheets,_=_workbook(path)
    for sheet,cells in sheets.items():
        grouped={}
        for address,cell in cells.items():
            row,column=cell_position(address)
            grouped.setdefault(row,{})[column]=cell.get('raw')
        if len(grouped)>MAX_ROWS:raise ValueError('Worksheet exceeds 2000 supported rows; split the source first.')
        header=grouped.get(1,{})
        long_table=all(name in [str(x).strip().lower() for x in header.values()] for name in ['metric_key','raw_value'])
        for number,data in sorted(grouped.items()):
            if long_table and number==1:continue
            if long_table:
                indices=sorted(header);columns=[header[c] for c in indices];values=[data.get(c) for c in indices]
                raw_column=next(c for c in indices if str(header[c]).strip().lower()=='raw_value')
                # Each quote is one exact original cell; the metadata is retained in observations.
                raw=data.get(raw_column)
                if raw is None:continue
                yield number,columns,values,str(raw),{'kind':'xlsx_cell','sheet':sheet,'cell':f'{column_name(raw_column)}{number}'}
            else:
                for column,raw in sorted(data.items()):
                    if raw is None or not str(raw).strip():continue
                    name=column_name(column)
                    yield number,[name],[str(raw)],str(raw),{'kind':'xlsx_cell','sheet':sheet,'cell':f'{name}{number}'}


def xls_rows(path):
    """Decode BIFF cached cells without evaluating formulas, macros or dates.

    Numeric BIFF cells store binary doubles rather than an authored decimal
    string. Preserve that exact binary value as decimal text; do not infer its
    original formatting, currency, scale or normalized financial amount.
    """
    import xlrd
    from app.source_preview import column_name
    book=xlrd.open_workbook(filename=str(path),on_demand=True,ragged_rows=True)
    try:
        if book.nsheets>2000:raise ValueError('Legacy workbook exceeds 2000 supported sheets.')
        for sheet_number in range(book.nsheets):
            sheet=book.sheet_by_index(sheet_number)
            if sheet.nrows>MAX_ROWS or sheet.ncols>300:
                raise ValueError('Legacy worksheet exceeds 2000 rows or 300 columns; split the source first.')
            for row in range(sheet.nrows):
                for column in range(sheet.row_len(row)):
                    cell=sheet.cell(row,column)
                    if cell.ctype in (xlrd.XL_CELL_EMPTY,xlrd.XL_CELL_BLANK):continue
                    if cell.ctype in (xlrd.XL_CELL_NUMBER,xlrd.XL_CELL_DATE):
                        raw=str(Decimal.from_float(cell.value))
                    elif cell.ctype==xlrd.XL_CELL_BOOLEAN:
                        raw='TRUE' if cell.value else 'FALSE'
                    elif cell.ctype==xlrd.XL_CELL_ERROR:
                        raw=xlrd.error_text_from_code.get(cell.value,'Unknown cached cell error')
                    else:raw=str(cell.value)
                    if not raw.strip():continue
                    name=column_name(column+1)
                    yield row+1,[name],[raw],raw,{'kind':'xlsx_cell','sheet':sheet.name,'cell':f'{name}{row+1}',
                        'reading_basis':'xlrd native BIFF cached cell; no formula/macro evaluation'}
            book.unload_sheet(sheet_number)
    finally:book.release_resources()


def ocr_pdf(original, directory):
    """Tesseract OCR becomes a labeled derivative, preserving original bytes/hash."""
    from PIL import Image
    from pypdf import PdfReader, PdfWriter
    executable=os.getenv('TESSERACT_BIN') or shutil.which('tesseract')
    if not executable:raise ValueError('Image/scanned document reading needs Tesseract OCR on the backend.')
    directory.mkdir(parents=True,exist_ok=True)
    images=[]
    if original.suffix.lower()=='.pdf':
        import pypdfium2 as pdfium
        doc=pdfium.PdfDocument(original)
        try:
            if len(doc)>80:raise ValueError('OCR supports at most 80 pages per upload.')
            for index in range(len(doc)):
                page=doc[index];bitmap=page.render(scale=2)
                try:
                    target=directory/f'page-{index+1}.png';bitmap.to_pil().save(target);images.append(target)
                finally:bitmap.close();page.close()
        finally:doc.close()
    else:
        with Image.open(original) as image:
            frames=getattr(image,'n_frames',1)
            if frames>80:raise ValueError('Image exceeds 80 supported frames/pages.')
            for number in range(frames):
                image.seek(number)
                if image.width*image.height>40_000_000:raise ValueError('Image exceeds 40 million pixels.')
                target=directory/f'image-{number+1}.png';image.convert('RGB').save(target);images.append(target)
    writer=PdfWriter()
    for index,image in enumerate(images):
        stem=directory/f'ocr-{index}'
        result=subprocess.run([executable,str(image),str(stem),'-l',os.getenv('OCR_LANGUAGES','eng'),'pdf'],capture_output=True,timeout=120)
        if result.returncode:raise ValueError('OCR failed; original file is retained.')
        reader=PdfReader(stem.with_suffix('.pdf'))
        for page in reader.pages:writer.add_page(page)
    output=directory/'reading-view.pdf'
    with output.open('wb') as stream:writer.write(stream)
    return output


def _process_document(company, source, folder):
    """Unchanged B extraction + original-PDF quote validator + B-to-C normalizer."""
    from backend.evidence.ingest_document import ingest_document
    from backend.evidence.prepare_pdf import prepare_pdf
    from backend.evidence.process_contract import process_prepared
    from backend.evidence.save_to_db import save_prepared
    from app.store import Store
    original=Path(source.local_path);suffix=original.suffix.lower();warnings=[]
    image=suffix in {'.png','.jpg','.jpeg','.webp','.gif','.tif','.tiff','.bmp'}
    if suffix=='.pdf':
        from pypdf import PdfReader
        reader=PdfReader(original)
        if len(reader.pages)>80:raise ValueError('Document exceeds 80 supported pages.')
        image=any(not (p.extract_text() or '').strip() for p in reader.pages)
    if image:
        reading=ocr_pdf(original,folder/'ocr')
        prepare_pdf(reading,company.deal_id,folder/'prepared',company_name=company.legal_name)
        run=folder/'prepared';registry_path=run/'registry.json';registry=json.loads(registry_path.read_text())
        registry['document'].update(original_file_path=str(original),original_sha256=source.sha256,original_filename=source.original_filename,representation='ocr_pdf',original_locator_origin='ocr_reading_representation_not_native_text')
        atomic_json(registry_path,registry)
        process_prepared(run,folder/'results',workers=1)
        handoff=folder/'results/handoff.json'
        warnings.append('OCR reading view: quotations must be checked against the untouched original image/pages; OCR is not human verification.')
    else:
        status=ingest_document(original,company.deal_id,folder/'document',extract=True,workers=1,company_name=company.legal_name)
        run=Path(status['prepared_run']);handoff=folder/'document/results/handoff.json'
    bundle=json.loads(handoff.read_text())
    if not bundle.get('coverage',{}).get('all_batches_processed'):
        raise ValueError('Document extraction did not process every source batch; original file is retained for retry.')
    # B's SQL implementation remains intact: validate in a short-lived handoff
    # ledger, then publish its exact snapshots/claims through the selected store.
    with Store(':memory:') as scratch:
        save_prepared(scratch,run,handoff,company,upload_root()/'files',submit_numbers=True)
        snapshots=scratch.snapshots(company.deal_id);observations=scratch.observations(company.deal_id)
        claims=[DocumentClaim.model_validate(c) for c in scratch.document_claims(company.deal_id)]
    for snapshot in snapshots:
        if image and snapshot.sha256!=source.sha256:
            snapshot.context.update(representation_kind='ocr_pdf',original_snapshot_id=source.id,original_sha256=source.sha256)
    if image:
        for claim in claims:
            claim.limitations += ['Quotation located in a Tesseract OCR reading representation; compare it with the original image before relying on its wording.']
            for evidence in claim.evidence:
                evidence['representation_kind']='ocr_pdf'
                evidence['quote_match_rule']='tesseract_ocr_reading_pdf_text_v1'
                evidence['original_locator_origin']='ocr_page_order_preserved'
                evidence['original_locators']=[{'kind':'pdf_page' if suffix=='.pdf' else 'image_frame',
                    'page' if suffix=='.pdf' else 'frame_index':evidence['locator']['page']}]
                evidence['original_locator_status']='ocr_representation_requires_original_review'
            claim.id=claim_id(claim.model_dump(mode='json',exclude={'id'}))
    if not claims:
        warnings.append('No source-located claims were extracted; the original file remains available and gaps stay explicit.')
    return snapshots,observations,claims,warnings


def process_document(company, source, folder):
    # PDFium and Office conversions run serially within this process, while the
    # other bounded worker may accept native tables/text concurrently.
    with _DOCUMENT_LOCK:
        return _process_document(company, source, folder)


def process_upload(store, company, source, folder):
    path=Path(source.local_path);suffix=path.suffix.lower();warnings=[];snapshots=[source]
    if suffix in {'.csv','.tsv','.xlsx','.xlsm'}:
        intake,claims,warnings=table_intake(company,source,csv_rows(path) if suffix in {'.csv','.tsv'} else xlsx_rows(path))
        observations=intake.observations
        if suffix=='.xlsm':warnings.append('Macro-enabled workbook read as inert cached XML cells; macros and formulas were not executed.')
    elif suffix=='.xls':
        intake,claims,warnings=table_intake(company,source,xls_rows(path));observations=intake.observations
        basis='Legacy XLS numeric strings decode exact native binary double values; authored decimal formatting, units, scales and dates are not inferred. Formulas and macros were not evaluated.'
        for observation in observations:observation.notes.append(basis)
        for claim in claims:
            claim.limitations.append(basis)
            claim.evidence[0]['quote_match_rule']='xlrd_native_biff_cached_cell_v1'
            claim.id=claim_id(claim.model_dump(mode='json',exclude={'id'}))
        warnings.append(basis)
    elif suffix in {'.txt','.md','.json'}:
        lines=path.read_text(encoding='utf-8-sig').splitlines();claims=[];observations=[]
        for number,line in enumerate(lines,1):
            if line.strip() and len(claims)<MAX_CLAIMS:
                claims.append(quote_claim(company,source,line[:30000],{'kind':'text_lines','line_start':number,'line_end':number,'extraction_basis':'UTF-8 original splitlines, one-based','extractor_version':'workspace-source-v1'},f'Source line {number}'))
        if len(lines)>MAX_CLAIMS:warnings.append('Text extraction is capped at 500 nonempty lines; download the full original for complete context.')
    else:
        snapshots,observations,claims,warnings=process_document(company,source,folder)
    register_sources(snapshots)
    store.ingest(IngestionResult(company=company,snapshots=snapshots,observations=observations))
    persist_claims(store,company,claims)
    return {'snapshot_id':source.id,'observations':len(observations),'claims':len(claims),'warnings':warnings}
