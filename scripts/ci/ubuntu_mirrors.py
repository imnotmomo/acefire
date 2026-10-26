#!/usr/bin/env python3
"""Keep Ubuntu signing/suites intact while replacing slow HTTP mirror URLs."""
import argparse
from pathlib import Path
import re


def rewrite(text):
    substitutions = (
        (r'https?://azure\.archive\.ubuntu\.com/ubuntu(?=/|\s|$)', 'https://archive.ubuntu.com/ubuntu'),
        (r'http://archive\.ubuntu\.com/ubuntu(?=/|\s|$)', 'https://archive.ubuntu.com/ubuntu'),
        (r'http://security\.ubuntu\.com/ubuntu(?=/|\s|$)', 'https://security.ubuntu.com/ubuntu'),
    )
    for pattern, replacement in substitutions:
        text = re.sub(pattern, replacement, text)
    return text


def configure(root):
    apt = Path(root) / 'etc/apt'
    candidates = {apt/'sources.list', apt/'sources.list.d/ubuntu.sources', apt/'apt-mirrors.txt'}
    candidates.update((apt/'mirrors').glob('*.list'))
    changed = []
    for path in sorted(candidates):
        if not path.is_file():
            continue
        original = path.read_text()
        updated = rewrite(original)
        if updated != original:
            path.write_text(updated)
            changed.append(path)
        # Log only public Ubuntu repository URLs, never arbitrary source entries.
        urls = sorted(set(re.findall(r'https?://(?:archive|security)\.ubuntu\.com/ubuntu[^\s]*', updated)))
        if urls:
            print(f'Ubuntu package mirrors in {path}: {", ".join(urls)}')
    return changed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/', help='Filesystem root (use a temporary root for tests).')
    args = parser.parse_args()
    configure(args.root)
