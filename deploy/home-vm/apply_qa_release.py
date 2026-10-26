#!/usr/bin/python3 -I
"""Installed fixed QA controller; the QA sudo rule cannot select production."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_release


if __name__ == '__main__':
    apply_release.configure_target('qa')
    raise SystemExit(apply_release.main())
