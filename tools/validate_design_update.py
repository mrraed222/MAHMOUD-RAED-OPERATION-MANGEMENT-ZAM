#!/usr/bin/env python3
"""Static validation for the ZAM visual refresh."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGES = sorted(ROOT.rglob("*.html"))
errors: list[str] = []
logo_references = 0

for page in PAGES:
    content = page.read_text(encoding="utf-8")
    rel = page.relative_to(ROOT).as_posix()
    for required in ('family=Tajawal', 'id="zam-design-system"', 'zam-page'):
        if required not in content:
            errors.append(f"{rel}: missing {required}")
    body_tag = re.search(r"<body\b[^>]*>", content, flags=re.I | re.S)
    if not body_tag:
        errors.append(f"{rel}: missing body tag")
    elif len(re.findall(r"\bclass\s*=", body_tag.group(0), flags=re.I)) != 1:
        errors.append(f"{rel}: body tag does not contain exactly one class attribute")
    for src in re.findall(r'''\bsrc\s*=\s*["']([^"']*assets/logo/zam-logo\.png)["']''', content, flags=re.I):
        logo_references += 1
        target = (page.parent / src).resolve()
        if not target.is_file() or not target.is_relative_to(ROOT):
            errors.append(f"{rel}: broken logo source {src}")

shared = (ROOT / "assets" / "supabase-config.js").read_text(encoding="utf-8")
if "${pathPrefix}assets/logo/zam-logo.png" not in shared:
    errors.append("assets/supabase-config.js: dynamic sidebar does not use the approved local logo")
if re.search(r"ZAM Cafe|ZAM Speciality Coffee|Speciality Coffee Management", shared):
    errors.append("assets/supabase-config.js: old brand text remains")

print(f"Validated {len(PAGES)} HTML pages and {logo_references} direct local-logo references.")
if errors:
    print("FAILED")
    print("\n".join(errors))
    sys.exit(1)
print("PASS")
