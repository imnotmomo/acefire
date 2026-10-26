"""Inert, source-bound PDF page previews using a bounded isolated child."""
import base64
import json
from pathlib import Path
import os
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import BoundedSemaphore

MAX_PNG_BYTES = 8 * 1024 * 1024
MAX_FILE_BYTES = 50 * 1024 * 1024
RENDER_TIMEOUT_SECONDS = 10
_RENDERERS = BoundedSemaphore(2)


class PdfPreviewError(ValueError):
    def __init__(self, message, status_code=422):
        super().__init__(message)
        self.status_code = status_code


def _worker_environment(directory):
    environment = {'LANG':'C.UTF-8', 'LC_ALL':'C.UTF-8',
                   'TMPDIR':str(directory), 'TEMP':str(directory), 'TMP':str(directory)}
    if os.name == 'nt':
        windows_root = os.environ.get('SystemRoot') or os.environ.get('SYSTEMROOT')
        if windows_root:
            # Windows SxS/native DLL loading needs this OS installation path.
            # Provider credentials and every other inherited variable stay out.
            environment['SystemRoot'] = windows_root
    return environment


def render_pdf_preview(path, page, expected_sha256):
    path = Path(path)
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 2000:
        raise PdfPreviewError('Choose a PDF page from 1 to 2000.')
    if path.stat().st_size > MAX_FILE_BYTES:
        raise PdfPreviewError('PDF exceeds the 50 MiB page-preview limit. Download the original file instead.')
    if not _RENDERERS.acquire(blocking=False):
        raise PdfPreviewError('Both PDF preview workers are busy. Retry this page shortly.', 429)
    try:
        with TemporaryDirectory(prefix='acefire-pdf-preview-') as temporary:
            directory = Path(temporary)
            worker = Path(__file__).with_name('pdf_preview_worker.py').resolve()
            try:
                # Python -I ignores PYTHONPATH/user-site. No provider keys,
                # cloud credentials, tokens, shell or inherited user env enter.
                completed = subprocess.run([sys.executable, '-I', '-X', 'utf8', str(worker),
                    str(path.resolve()), expected_sha256, str(page), str(directory)],
                    cwd=directory, env=_worker_environment(directory),
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                    timeout=RENDER_TIMEOUT_SECONDS, start_new_session=os.name != 'nt', check=False)
            except subprocess.TimeoutExpired:
                raise PdfPreviewError('PDF page preview exceeded 10 seconds. Try another page or download the original file instead.') from None
            except OSError:
                raise PdfPreviewError('The PDF preview worker could not start. Retry shortly or download the original file.', 503) from None
            result_path = directory/'result.json'
            if completed.returncode != 0 or not result_path.is_file() or result_path.stat().st_size > 4096:
                raise PdfPreviewError('This PDF page exceeded preview resource limits. Download the original file instead.')
            try:
                result = json.loads(result_path.read_text(encoding='utf-8'))
                if isinstance(result, dict) and isinstance(result.get('error'), str):
                    raise PdfPreviewError(result['error'][:500], 409 if result.get('status_code') == 409 else 422)
                if (not isinstance(result, dict) or set(result) != {'page','page_count','width','height'}
                        or any(type(result[key]) is not int for key in result)
                        or result['page'] != page or not page <= result['page_count'] <= 2000
                        or not 1 <= result['width'] <= 1600 or not 1 <= result['height'] <= 8192
                        or result['width'] * result['height'] > 4_000_000):
                    raise ValueError('Invalid preview metadata')
                png_path = directory/'page.png'
                if not png_path.is_file() or not 24 <= png_path.stat().st_size <= MAX_PNG_BYTES:
                    raise ValueError('Invalid preview image size')
                content = png_path.read_bytes()
                if (content[:8] != b'\x89PNG\r\n\x1a\n' or content[12:16] != b'IHDR'
                        or int.from_bytes(content[16:20], 'big') != result['width']
                        or int.from_bytes(content[20:24], 'big') != result['height']):
                    raise ValueError('Invalid preview image header')
                return {**result, 'png_base64': base64.b64encode(content).decode('ascii')}
            except PdfPreviewError:
                raise
            except (ValueError, KeyError, OSError, TypeError):
                raise PdfPreviewError('The PDF renderer returned an invalid page preview. Download the original file instead.') from None
    finally:
        _RENDERERS.release()
