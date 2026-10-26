"""Trusted one-page raster worker. Called by absolute path under Python -I."""
import hashlib
import json
import math
from pathlib import Path
import sys

MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_PNG_BYTES = 8 * 1024 * 1024
MAX_PAGES = 2000
MAX_WIDTH = 1600
MAX_HEIGHT = 8192
MAX_PIXELS = 4_000_000
MAX_PAGE_POINTS = 20_000


def restrict_resources():
    try:
        import resource
    except ImportError:  # Windows still has the parent wall-clock/output limits.
        return
    for name, soft, hard in [('RLIMIT_CPU', 5, 6), ('RLIMIT_FSIZE', MAX_PNG_BYTES, MAX_PNG_BYTES),
                             ('RLIMIT_NOFILE', 64, 64), ('RLIMIT_CORE', 0, 0)]:
        if hasattr(resource, name):
            resource.setrlimit(getattr(resource, name), (soft, hard))
    # macOS reserves a large virtual address range before this trusted script
    # starts; Linux production workers can enforce an address-space bound.
    if sys.platform.startswith('linux') and hasattr(resource, 'RLIMIT_AS'):
        resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))


def render(path, expected_sha256, requested_page, directory):
    import pypdfium2 as pdfium
    if path.stat().st_size > MAX_FILE_BYTES:
        raise ValueError('PDF exceeds the 50 MiB page-preview limit. Download the original file instead.')
    content = path.read_bytes()
    if hashlib.sha256(content).hexdigest() != expected_sha256:
        return {'error': 'Source bytes changed; the recorded evidence version cannot be displayed.', 'status_code': 409}
    try:
        document = pdfium.PdfDocument(content)
    except pdfium.PdfiumError:
        raise ValueError('This file cannot be decoded as a PDF. Encrypted or damaged PDFs cannot be previewed; download the original file instead.') from None
    with document:
        count = len(document)
        if not 1 <= count <= MAX_PAGES:
            raise ValueError('PDF page count exceeds the supported range of 1–2000 pages. Download the original file instead.')
        if not 1 <= requested_page <= count:
            raise ValueError(f'Page {requested_page} is outside this PDF. Choose a page from 1 to {count}.')
        page = document[requested_page - 1]
        try:
            width, height = page.get_size()
            if (not all(math.isfinite(value) and 0 < value <= MAX_PAGE_POINTS for value in (width, height))):
                raise ValueError('PDF page dimensions exceed safe preview limits. Download the original file instead.')
            scale = min(MAX_WIDTH / width, MAX_HEIGHT / height, math.sqrt(MAX_PIXELS / (width * height)), 3)
            for _ in range(3):
                pixels = math.ceil(width * scale) * math.ceil(height * scale)
                if pixels <= MAX_PIXELS:
                    break
                scale *= math.sqrt(MAX_PIXELS / pixels) * .999999
            rendered_width, rendered_height = math.ceil(width * scale), math.ceil(height * scale)
            if not (1 <= rendered_width <= MAX_WIDTH and 1 <= rendered_height <= MAX_HEIGHT
                    and rendered_width * rendered_height <= MAX_PIXELS):
                raise ValueError('PDF page dimensions exceed safe preview limits. Download the original file instead.')
            # PdfDocument has no form environment by default. Never call
            # init_forms(), JavaScript actions, or document-edit/save methods.
            bitmap = page.render(scale=scale, may_draw_forms=False, draw_annots=True,
                                 limit_image_cache=True, rev_byteorder=True)
            try:
                image = bitmap.to_pil()
                try:
                    image.save(directory/'page.png', format='PNG', optimize=False)
                finally:
                    image.close()
            finally:
                bitmap.close()
            if (directory/'page.png').stat().st_size > MAX_PNG_BYTES:
                raise ValueError('Rendered PDF page exceeds the 8 MiB preview limit. Download the original file instead.')
            return {'page': requested_page, 'page_count': count, 'width': rendered_width, 'height': rendered_height}
        finally:
            page.close()


def main():
    directory = Path(sys.argv[4])
    try:
        restrict_resources()
        result = render(Path(sys.argv[1]), sys.argv[2], int(sys.argv[3]), directory)
    except ValueError as error:
        result = {'error': str(error)[:500], 'status_code': 422}
    except (MemoryError, OSError):
        result = {'error': 'This PDF page exceeded preview resource limits. Download the original file instead.', 'status_code': 422}
    except Exception:
        result = {'error': 'This PDF page could not be rendered safely. Download the original file instead.', 'status_code': 422}
    (directory/'result.json').write_text(json.dumps(result), encoding='utf-8')


if __name__ == '__main__':
    main()
