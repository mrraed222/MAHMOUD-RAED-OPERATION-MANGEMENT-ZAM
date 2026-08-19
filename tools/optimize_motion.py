#!/usr/bin/env python3
"""Remove expensive perpetual UI animation while preserving subtle, accessible interaction feedback."""
from __future__ import annotations

from pathlib import Path

root = Path(__file__).resolve().parents[1]
replacements = {
    '.zam-logo { animation: zamFadeInUp .65s ease-out both, zamLogoGlow 3.2s ease-in-out infinite .7s; }':
        '.zam-logo { filter: none; }',
    'body.zam-page main { animation: zamFadeInUp .46s ease-out both; }':
        'body.zam-page main { animation: none; }',
    '.zam-card { transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease; }':
        '.zam-card { transition: border-color .14s ease, background-color .14s ease; }',
    '.zam-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(51, 33, 13, .12); border-color: var(--zam-focus) !important; }':
        '.zam-card:hover { border-color: var(--zam-focus) !important; }',
    '.zam-btn, button, [role="button"] { transition: transform .15s ease, box-shadow .18s ease, background-color .18s ease; }':
        '.zam-btn, button, [role="button"] { transition: background-color .14s ease, border-color .14s ease; }',
    '.zam-btn:hover, button:hover, [role="button"]:hover { box-shadow: 0 4px 14px rgba(51, 33, 13, .15); }':
        '.zam-btn:hover, button:hover, [role="button"]:hover { filter: brightness(.98); }',
    '.zam-btn:active, button:active, [role="button"]:active { transform: scale(.98); }':
        '.zam-btn:active, button:active, [role="button"]:active { filter: brightness(.95); }',
    '.zam-loading { animation: zamSoftPulse 1.7s ease-in-out infinite; }':
        '.zam-loading { opacity: .82; }',
}

changed = []
for page in root.rglob('*.html'):
    content = page.read_text(encoding='utf-8')
    updated = content
    for old, new in replacements.items():
        updated = updated.replace(old, new)
    if updated != content:
        page.write_text(updated, encoding='utf-8')
        changed.append(page.relative_to(root).as_posix())
print(f'Optimized motion in {len(changed)} pages')
for item in changed:
    print(item)
