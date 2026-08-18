#!/usr/bin/env python3
"""Apply the approved ZAM design system consistently across static HTML pages."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "assets" / "logo" / "zam-logo.png"
FONT_URL = "https://fonts.googleapis.com/css2?family=Tajawal:wght@300;400;500;600;700;800&display=swap"
OLD_LOGO_URLS = {
    "https://lh3.googleusercontent.com/aida-public/AB6AXuBC116lYuGTCZ4Col21g9_YQOIDwV9B0_2DlO3lxVAduFLfOox1goi8Ho19i1EIHtE1loBlFG2GTlbxzbuUaKhYgEQWiM47m3a973ptlWEu05VZRFAnqHTKqFvh2wJM48MI59_rPOol-iGTGS6syoXXYi9J3drHZW3rhdUx2bhfIE-trF2-IXdFyg8XUS0sGxGXZtQXyjqhxo__gvg0V1l65emrxd7GpzTRQ0LNXtsgg_jeXioIW2pU07J9cQzpNjOPBA",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuAHYjgc7-eHXckPir6xT6Xzc1JNl0hItkD1yF71b62A5frAA5eteEdI18Mc8RP8ZlZLBF4ZeBhX-d13FeVqvDMi6wKmruamvwo3BGpfLZky0bs6d5Vln2w1n5DqsKfSfWTn5lKXesAQ8Ku_WHvbiG4EAMG6g7aMQxV0vv4RYQOSAhL4G9MOdCjwQ4GQ0_sFmo0xQOpkbT6i04J4U7sctAJexifNjbeQDiJxKxPVIVlZ-HHqUhUj4rUkYRMiCKqwWcdzhw",
    "https://lh3.googleusercontent.com/aida-public/AB6AXuB_zDG_2qTlgZVrmyvFCMa_dD5IoGrqsvbVTI6mxsY-OnPweUq0gZvzixXP3Zse-FdcbiNYODy_CxAbLQ9IadjolG5w9SSKCfjBqMNm_P23DjLPfnDXp6cKGNt3TbBvcMgQTeqkeI8SSdyXNhJe5L7MkTJVZRcACevAO-l4VTW24xTNj4ggA29CzBAhy5DvsT60jNbq4XKknpI7C9AEUPh5sBIF2UDfGqJMPsZ_H8BGCtApm83PY7XxoFrSDxWCCQUc-g",
}

FONT_FAMILIES = '''"fontFamily": {"title-md": ["Tajawal", "sans-serif"], "headline-lg": ["Tajawal", "sans-serif"], "label-bold": ["Tajawal", "sans-serif"], "display-lg": ["Tajawal", "sans-serif"], "body-lg": ["Tajawal", "sans-serif"], "body-sm": ["Tajawal", "sans-serif"]}'''

DESIGN_CSS = r'''<style id="zam-design-system">
:root {
  --zam-coffee: #33210d;
  --zam-coffee-light: #4b3621;
  --zam-focus: #c0583a;
  --zam-surface: #fcf9f8;
}
body.zam-page {
  font-family: "Tajawal", sans-serif;
  text-rendering: optimizeLegibility;
}
@keyframes zamFadeInUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
@keyframes zamLogoGlow { 0%, 100% { filter: drop-shadow(0 0 3px rgba(192, 88, 58, .20)); } 50% { filter: drop-shadow(0 0 12px rgba(192, 88, 58, .48)); } }
@keyframes zamSoftPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(192, 88, 58, .22); } 50% { box-shadow: 0 0 0 7px rgba(192, 88, 58, 0); } }
.zam-logo { animation: zamFadeInUp .65s ease-out both, zamLogoGlow 3.2s ease-in-out infinite .7s; }
body.zam-page main { animation: zamFadeInUp .46s ease-out both; }
.zam-card { transition: transform .22s ease, box-shadow .22s ease, border-color .22s ease; }
.zam-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(51, 33, 13, .12); border-color: var(--zam-focus) !important; }
.zam-btn, button, [role="button"] { transition: transform .15s ease, box-shadow .18s ease, background-color .18s ease; }
.zam-btn:hover, button:hover, [role="button"]:hover { box-shadow: 0 4px 14px rgba(51, 33, 13, .15); }
.zam-btn:active, button:active, [role="button"]:active { transform: scale(.98); }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 3px solid rgba(192, 88, 58, .42); outline-offset: 2px; }
.zam-loading { animation: zamSoftPulse 1.7s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }
</style>'''


def logo_relative_path(page: Path) -> str:
    return Path(__import__("os").path.relpath(LOGO, page.parent)).as_posix()


def add_logo_class(match: re.Match[str]) -> str:
    tag = match.group(0)
    if "zam-logo" in tag:
        return tag
    class_match = re.search(r'\bclass\s*=\s*(["\'])(.*?)\1', tag, flags=re.I | re.S)
    if class_match:
        existing = class_match.group(2).strip()
        replacement = f'class={class_match.group(1)}{existing} zam-logo{class_match.group(1)}'
        return tag[:class_match.start()] + replacement + tag[class_match.end():]
    return tag[:-1] + ' class="zam-logo">'


def normalize_body_class(match: re.Match[str]) -> str:
    """Ensure one class attribute that preserves prior classes and adds zam-page."""
    tag = match.group(0)
    classes: list[str] = []
    for class_match in re.finditer(r'\bclass\s*=\s*(["\'])(.*?)\1', tag, flags=re.I | re.S):
        classes.extend(class_match.group(2).split())
    ordered = ["zam-page"] + [name for name in classes if name != "zam-page"]
    unique: list[str] = []
    for name in ordered:
        if name not in unique:
            unique.append(name)
    tag_without_class = re.sub(r'\s+class\s*=\s*(["\'])(.*?)\1', '', tag, flags=re.I | re.S)
    return tag_without_class[:-1] + f' class="{" ".join(unique)}">'


def transform(page: Path) -> bool:
    content = page.read_text(encoding="utf-8")
    original = content
    relative_logo = logo_relative_path(page)

    # Use one Arabic-first family throughout each document.
    content = re.sub(
        r'<link\s+[^>]*href=["\']https://fonts\.googleapis\.com/css2\?[^"\']*(?:Montserrat|Noto\+Sans\+Arabic|Almarai|Tajawal)[^"\']*["\'][^>]*>\s*',
        '', content, flags=re.I)
    if FONT_URL not in content:
        anchor = re.search(r'<meta\s+charset=["\']utf-8["\']\s*/?>', content, flags=re.I)
        font_link = f'<link href="{FONT_URL}" rel="stylesheet">'
        content = content[:anchor.end()] + font_link + content[anchor.end():] if anchor else font_link + content

    content = re.sub(r'"fontFamily"\s*:\s*\{[^{}]*\}', FONT_FAMILIES, content, flags=re.S)
    content = content.replace("font-family: 'Noto Sans Arabic', 'Montserrat', sans-serif", 'font-family: "Tajawal", sans-serif')
    content = content.replace("font-family: 'Montserrat', 'Noto Sans Arabic', sans-serif", 'font-family: "Tajawal", sans-serif')

    for old_url in OLD_LOGO_URLS:
        content = content.replace(old_url, relative_logo)

    # Brand text only; operational content remains unchanged.
    content = content.replace('ZAM Speciality Coffee', 'ZAM Operations System')
    content = content.replace('Speciality Coffee Management', 'Operations Management System')
    content = content.replace('ZAM Cafe', 'ZAM Operations System')

    # Add the class only to the approved local logo, never to other images.
    target_src = re.escape(relative_logo)
    content = re.sub(r'<img\b[^>]*\bsrc=(["\'])' + target_src + r'\1[^>]*>', add_logo_class, content, flags=re.I | re.S)

    if 'id="zam-design-system"' not in content:
        content = content.replace('</head>', DESIGN_CSS + '\n</head>', 1)
    content = re.sub(r'<body\b[^>]*>', normalize_body_class, content, count=1, flags=re.I | re.S)

    if content != original:
        page.write_text(content, encoding="utf-8")
        return True
    return False


def main() -> None:
    if not LOGO.is_file():
        raise SystemExit(f"Approved logo is missing: {LOGO}")
    pages = sorted(ROOT.rglob("*.html"))
    changed = [page.relative_to(ROOT).as_posix() for page in pages if transform(page)]
    print(f"Updated {len(changed)}/{len(pages)} HTML pages.")
    for page in changed:
        print(page)


if __name__ == "__main__":
    main()
