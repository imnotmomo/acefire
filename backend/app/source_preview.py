"""Read-only source views; formulas remain source text and are never executed."""
import re
from pathlib import Path
from zipfile import ZipFile

from app.local_sources import _workbook


def column_name(number):
    result = ''
    while number:
        number, digit = divmod(number - 1, 26)
        result = chr(65 + digit) + result
    return result


def cell_position(address):
    match = re.fullmatch(r'([A-Z]{1,3})([1-9][0-9]{0,6})', address or '')
    if not match:
        raise ValueError('Use an Excel cell address such as I49.')
    column = 0
    for char in match[1]:
        column = column * 26 + ord(char) - 64
    row = int(match[2])
    if column > 16384 or row > 1048576:
        raise ValueError('Cell address is outside an Excel worksheet.')
    return row, column


def workbook_preview(path: Path, sheet=None, cell=None, row_start=None, column_start=None):
    if path.suffix.lower() != '.xlsx':
        raise ValueError('Structured workbook viewing supports .xlsx source files.')
    with ZipFile(path) as archive:
        if len(archive.infolist()) > 2000 or sum(i.file_size for i in archive.infolist()) > 50_000_000:
            raise ValueError('Workbook exceeds the supported preview size; download the original instead.')
    sheets, _ = _workbook(path)
    if not sheets:
        raise ValueError('No readable worksheets were found.')
    selected = sheet or next(iter(sheets))
    if selected not in sheets:
        raise ValueError('The requested worksheet is not present in this source.')
    focus_row, focus_column = cell_position(cell) if cell else (1, 1)
    first_row = row_start or max(1, focus_row - 12)
    first_column = column_start or (1 if focus_column <= 16 else max(1, focus_column - 8))
    cells = sheets[selected]
    positions = [cell_position(address) for address in cells if re.fullmatch(r'[A-Z]{1,3}[1-9][0-9]{0,6}', address)]
    max_row = max([focus_row, *(p[0] for p in positions)])
    max_column = max([focus_column, *(p[1] for p in positions)])
    last_row = min(max_row, first_row + 49)
    last_column = min(max_column, first_column + 15)
    rows = []
    for row in range(first_row, last_row + 1):
        values = []
        for column in range(first_column, last_column + 1):
            address = f'{column_name(column)}{row}'
            original = cells.get(address, {})
            values.append({'address': address, 'value': original.get('raw'), 'formula': original.get('formula'),
                           'number_format': original.get('number_format'), 'selected': address == cell})
        rows.append({'number': row, 'cells': values})
    return {'kind': 'workbook', 'sheets': list(sheets), 'sheet': selected, 'focus_cell': cell,
            'row_start': first_row, 'column_start': first_column, 'max_row': max_row, 'max_column': max_column,
            'columns': [column_name(c) for c in range(first_column, last_column + 1)], 'rows': rows,
            'formula_evaluation': False, 'value_basis': 'original_cached_cell_values'}
