"""Keep generated presentation prose in English without altering source text."""
import re


_HAN = re.compile(r'[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U000323af]')


class OutputLanguageError(ValueError):
    """Generated wording has the wrong language; original evidence is valid."""


def contains_han(text: str) -> bool:
    """Detect Chinese characters in generated prose, never in source quotations."""
    return bool(_HAN.search(text))
