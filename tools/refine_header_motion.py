#!/usr/bin/env python3
"""Refine fixed-header spacing and add one-time, low-cost page entrance motion."""
from __future__ import annotations

import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
replacements = {
    'body.zam-page main { animation: none; }':
        'body.zam-page main { animation: zamFadeInUp .28s cubic-bezier(.2,.7,.3,1) both; }',
    '.zam-logo { filter: none; }':
        '.zam-logo { animation: zamFadeInUp .32s cubic-bezier(.2,.7,.3,1) both; }',
    '.zam-card { transition: border-color .14s ease, background-color .14s ease; }':
        '.zam-card { transition: transform .16s ease, border-color .16s ease, background-color .16s ease; }',
    '.zam-card:hover { border-color: var(--zam-focus) !important; }':
        '.zam-card:hover { transform: translateY(-1px); border-color: var(--zam-focus) !important; }',
}

changed = []
for page in root.rglob('*.html'):
    content = page.read_text(encoding='utf-8')
    updated = content
    for old, new in replacements.items():
        updated = updated.replace(old, new)
    # Fixed headers need breathing room after the 280px right sidebar.
    updated = re.sub(
        r'(<header\b[^>]*\bclass="[^"]*)md:pr-\[280px\]',
        r'\1md:pr-[312px]',
        updated,
    )
    if updated != content:
        page.write_text(updated, encoding='utf-8')
        changed.append(page.relative_to(root).as_posix())
print(f'Refined headers and motion in {len(changed)} pages')
for item in changed:
    print(item)
