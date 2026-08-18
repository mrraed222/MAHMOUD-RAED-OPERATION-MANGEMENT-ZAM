#!/usr/bin/env python3
"""Replace residual ZAM brand logo URLs with the approved local asset."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "assets" / "logo" / "zam-logo.png"


def relative_logo_path(page: Path) -> str:
    import os
    return Path(os.path.relpath(LOGO, page.parent)).as_posix()


def with_logo_class(tag: str) -> str:
    if "zam-logo" in tag:
        return tag
    class_match = re.search(r'\bclass\s*=\s*(["\'])(.*?)\1', tag, re.I | re.S)
    if class_match:
        value = class_match.group(2).strip()
        replacement = f'class={class_match.group(1)}{value} zam-logo{class_match.group(1)}'
        return tag[:class_match.start()] + replacement + tag[class_match.end():]
    return tag[:-1] + ' class="zam-logo">'


def transform_page(page: Path) -> bool:
    content = page.read_text(encoding="utf-8")
    original = content
    logo_path = relative_logo_path(page)

    def replace_tag(match: re.Match[str]) -> str:
        tag = match.group(0)
        alt = re.search(r'\balt\s*=\s*(["\'])(.*?)\1', tag, re.I | re.S)
        if not alt or not re.search(r'\bZAM\b.*\b(?:Logo|Coffee)\b', alt.group(2), re.I):
            return tag
        tag = re.sub(r'\bsrc\s*=\s*(["\']).*?\1', f'src="{logo_path}"', tag, count=1, flags=re.I | re.S)
        return with_logo_class(tag)

    content = re.sub(r'<img\b[^>]*>', replace_tag, content, flags=re.I | re.S)
    if content != original:
        page.write_text(content, encoding="utf-8")
        return True
    return False


def transform_sidebar() -> bool:
    page = ROOT / "assets" / "supabase-config.js"
    content = page.read_text(encoding="utf-8")
    original = content
    content = re.sub(
        r'<img alt="ZAM Logo" class="([^"]*)" src="[^"]*"/?>',
        r'<img alt="ZAM Operations System" class="\1 zam-logo" src="${pathPrefix}assets/logo/zam-logo.png"/>',
        content,
        count=1,
    )
    content = content.replace('>ZAM Cafe<', '>ZAM Operations System<')
    content = content.replace('>ZAM Speciality Coffee<', '>ZAM Operations System<')
    if content != original:
        page.write_text(content, encoding="utf-8")
        return True
    return False


def main() -> None:
    if not LOGO.is_file():
        raise SystemExit(f"Missing approved logo: {LOGO}")
    changed = [p.relative_to(ROOT).as_posix() for p in sorted(ROOT.rglob("*.html")) if transform_page(p)]
    if transform_sidebar():
        changed.append("assets/supabase-config.js")
    print("Updated: " + (", ".join(changed) if changed else "none"))


if __name__ == "__main__":
    main()
