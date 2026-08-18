#!/usr/bin/env python3
"""Extract inline scripts from analytics page and validate JavaScript syntax only."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
page = root / 'analytics' / 'index.html'
content = page.read_text(encoding='utf-8')
scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', content, flags=re.I | re.S)
inline = [script for script in scripts if script.strip()]
if not inline:
    raise SystemExit('No inline scripts found')
with tempfile.NamedTemporaryFile(mode='w', suffix='.js', encoding='utf-8', delete=False) as handle:
    handle.write('\n\n'.join(inline))
    temp_path = Path(handle.name)
try:
    checked = subprocess.run(['node', '--check', str(temp_path)], capture_output=True, text=True)
    if checked.returncode:
        raise SystemExit(checked.stderr.strip() or 'JavaScript syntax validation failed')
finally:
    temp_path.unlink(missing_ok=True)
required = [
    'type="month" id="f-month"',
    'إجمالي الكمية حسب الوحدة',
    "'month'",
]
missing = [token for token in required if token not in content]
if missing:
    raise SystemExit('Missing expected content: ' + ', '.join(missing))
if 'waste.slice(0, 200)' in content or 'issues.slice(0, 200)' in content:
    raise SystemExit('Filtered results are still silently limited to 200 rows')
print('PASS: analytics inline JavaScript and requested monthly aggregation controls')
