#!/usr/bin/env python3
"""Validate branch-level waste ranking markup and JavaScript syntax."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
page = root / 'analytics' / 'index.html'
content = page.read_text(encoding='utf-8')
required = [
    'id="waste-branch-ranking-tbody"',
    'id="waste-branch-sort"',
    'إجمالي الجرام',
    'إجمالي المليلتر',
    'function normalizeWasteUnit(unit)',
    "return 'grams'",
    "return 'milliliters'",
    "renderWasteAggregation();",
]
for token in required:
    if token not in content:
        raise SystemExit(f'Missing required ranking feature: {token}')
for forbidden in ('id="waste-grouped-cards"', 'إجمالي الكمية حسب الوحدة', 'quantitySummary'):
    if forbidden in content:
        raise SystemExit(f'Old presentation remains: {forbidden}')
scripts = [script for script in re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', content, flags=re.I | re.S) if script.strip()]
with tempfile.NamedTemporaryFile(mode='w', suffix='.js', encoding='utf-8', delete=False) as handle:
    handle.write('\n\n'.join(scripts))
    path = Path(handle.name)
try:
    result = subprocess.run(['node', '--check', str(path)], capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr.strip() or 'Analytics JavaScript syntax error')
finally:
    path.unlink(missing_ok=True)
print('PASS: branch waste ranking, unit separation, and filter-linked analytics syntax')
