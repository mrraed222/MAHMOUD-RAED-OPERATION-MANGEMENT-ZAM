#!/usr/bin/env python3
"""Bump the shared Supabase configuration cache token across static HTML pages."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
changed = []
for page in root.rglob('*.html'):
    content = page.read_text(encoding='utf-8')
    updated = content.replace('assets/supabase-config.js?v=20260818', 'assets/supabase-config.js?v=20260819')
    if updated != content:
        page.write_text(updated, encoding='utf-8')
        changed.append(page.relative_to(root).as_posix())
print(f'Updated cache token in {len(changed)} pages')
