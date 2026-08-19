#!/usr/bin/env python3
"""Static checks for the analytics/dashboard refresh without running browser code."""
from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
analytics = (root / 'analytics' / 'index.html').read_text(encoding='utf-8')
reports_log = (root / 'reports-log' / 'index.html').read_text(encoding='utf-8')
errors = []

for token in ('id="waste-grouped-cards"', 'الأصناف الأكثر هدراً', 'max-h-[34vh] overflow-y-auto'):
    if token not in analytics:
        errors.append(f'Missing analytics token: {token}')
for forbidden in ('id="reports-tbody"', 'إجمالي الكمية حسب الوحدة', 'quantitySummary', 'getAnalyticsReports('):
    if forbidden in analytics:
        errors.append(f'Unexpected analytics content: {forbidden}')
for token in ("filter(report => !report.custom_fields?.technical_parent)", "toLocaleString('ar-SA'"):
    if token not in reports_log:
        errors.append(f'Missing report-log repair: {token}')

scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', analytics, flags=re.I | re.S)
inline = [script for script in scripts if script.strip()]
with tempfile.NamedTemporaryFile(mode='w', suffix='.js', encoding='utf-8', delete=False) as handle:
    handle.write('\n\n'.join(inline))
    js_path = Path(handle.name)
try:
    completed = subprocess.run(['node', '--check', str(js_path)], capture_output=True, text=True)
    if completed.returncode:
        errors.append(completed.stderr.strip() or 'Analytics JavaScript syntax error')
finally:
    js_path.unlink(missing_ok=True)

pages = list(root.rglob('*.html'))
if not pages:
    errors.append('No HTML pages found')
for page in pages:
    content = page.read_text(encoding='utf-8')
    if '<header' in content and 'md:pr-[280px]' in re.search(r'<header\b.*?</header>', content, flags=re.S).group(0):
        errors.append(f'Unrefined header spacing: {page.relative_to(root)}')
    if 'zamLogoGlow 3.2s ease-in-out infinite' in content:
        errors.append(f'Expensive perpetual motion remains: {page.relative_to(root)}')

if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: analytics cards, report-log sales filter, smooth motion, and header spacing across {len(pages)} pages')
