"""English views of imported reports, without changing immutable source records."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re

HAN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0002fa1f]')
NUMBER = re.compile(r'([+\-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(billion|million|thousand|hundred|亿|万|千|百))?', re.I)
SCALES = {'billion': '1000000000', 'million': '1000000', 'thousand': '1000',
          'hundred': '100', '亿': '100000000', '万': '10000', '千': '1000', '百': '100'}
CHINESE_NUMBERS = re.compile(r'[零〇一二两三四五六七八九十百千万亿]+')
CHINESE_DIGITS = dict(zip('零〇一二两三四五六七八九', (0, 0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9)))


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def number_values(text):
    """Compare values across language-only Chinese/English magnitude notation."""
    values = {Decimal(number.replace(',', '')) * Decimal(SCALES.get(scale.lower(), '1'))
              for number, scale in NUMBER.findall(text)}

    def chinese_number(value):
        if all(character in CHINESE_DIGITS for character in value):
            return int(''.join(str(CHINESE_DIGITS[character]) for character in value))
        for unit, multiplier in (('亿', 100_000_000), ('万', 10_000)):
            if unit in value:
                left, right = value.split(unit, 1)
                return chinese_number(left or '一') * multiplier + (chinese_number(right) if right else 0)
        total, digit = 0, 0
        for character in value:
            if character in CHINESE_DIGITS:
                digit = CHINESE_DIGITS[character]
            else:
                total += (digit or 1) * {'十': 10, '百': 100, '千': 1000}[character]
                digit = 0
        return total + digit

    for match in CHINESE_NUMBERS.finditer(text):
        # An Arabic number's suffix was already handled by NUMBER above.
        if match.start() and text[match.start() - 1].isdigit():
            continue
        values.add(Decimal(chinese_number(match.group())))
    return values


def checked_translation(original, translated):
    if not isinstance(translated, str) or not translated.strip() or len(translated) > 30_000 or HAN.search(translated):
        raise ValueError('The English report presentation contains untranslated or invalid prose.')
    if not number_values(translated) <= number_values(original):
        raise ValueError('The English report translation introduces a numeric value absent from the original prose.')
    return translated


def prose_values(report):
    """Only strings used by the saved-draft adapter; quotations are excluded."""
    for section in report.get('sections', []):
        yield section.get('title', '')
        yield section.get('config', {}).get('focus', '')
        for entry in section.get('entries', []):
            yield entry.get('text', '')
    yield from report.get('limitations', [])


def _manifest():
    configured = os.getenv('INGENIUM_ENGLISH_TRANSLATIONS')
    system_path = Path('/etc/ingenium/english-translations.json')
    path = Path(configured) if configured else system_path if system_path.is_file() else Path(__file__).resolve().parents[1] / '.cache' / 'english-translations.json'
    if not path.is_file():
        return None
    if path.stat().st_size > 4_000_000:
        raise ValueError('English report presentation manifest exceeds its size limit.')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise ValueError('The English report presentation manifest is unreadable.') from error
    if (not isinstance(data, dict) or data.get('schema_version') != 1
            or data.get('language') != 'en' or not isinstance(data.get('reports'), dict)
            or not isinstance(data.get('translations'), dict)):
        raise ValueError('Unsupported English report presentation manifest.')
    return data


def english_report(report):
    """Return a derived view, retaining report/entry IDs and exact source bytes."""
    needs_translation = any(HAN.search(value) for value in prose_values(report) if isinstance(value, str))
    if not needs_translation:
        return report, None
    data = _manifest()
    record_sha256 = digest(canonical(report))
    binding = data.get('reports', {}).get(report['id']) if data else None
    if not isinstance(binding, dict) or binding.get('record_sha256') != record_sha256:
        raise ValueError('An English version of this saved report is not available for its current source version.')

    def translate(value):
        if not isinstance(value, str) or not HAN.search(value):
            return value
        translated = data['translations'].get(digest(value))
        if translated is None:
            raise ValueError('The English version of this saved report is incomplete.')
        return checked_translation(value, translated)

    result = deepcopy(report)
    for section in result.get('sections', []):
        section['title'] = translate(section.get('title', ''))
        if 'focus' in section.get('config', {}):
            section['config']['focus'] = translate(section['config']['focus'])
        for entry in section.get('entries', []):
            entry['text'] = translate(entry.get('text', ''))
    result['limitations'] = [translate(value) for value in result.get('limitations', [])]
    original_language = report.get('language', 'unknown')
    result['language'] = 'en'
    metadata = {'language': 'en', 'original_language': original_language,
                'source_record_sha256': record_sha256, 'manifest_sha256': digest(canonical(data)),
                'model': data.get('model', 'unspecified'), 'translated_at': data.get('translated_at'),
                'human_reviewed': False, 'original_records_preserved': True}
    return result, metadata
