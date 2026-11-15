from html.parser import HTMLParser
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self._current = None
        self._external = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'script':
            attrs = dict(attrs)
            self._external = 'src' in attrs
            self._current = [] if not self._external else None

    def handle_data(self, data):
        if self._current is not None:
            self._current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'script' and self._current is not None:
            source = ''.join(self._current).strip()
            if source:
                self.scripts.append(source)
            self._current = None
            self._external = False


def require(condition, message):
    if not condition:
        raise AssertionError(message)


history = (ROOT / 'branch-visits-history/index.html').read_text()
print_fn = history[history.index('async function printVisit(id){'):history.index('apply.onclick=load;')]
require("from('visit_evidence')" in print_fn, 'direct printing must read visit evidence')
require("createSignedUrl(item.file_path,600)" in print_fn, 'direct printing must use temporary evidence URLs')
require('class="attachments"' in print_fn and 'المرفقات' in print_fn, 'direct printing must render an attachments section')
require('window.print()' in print_fn, 'direct printing must trigger the print dialog after page load')

pdf = (ROOT / 'supabase/functions/visit-report-pdf/index.ts').read_text()
require("storage.from('task-evidence').download(item.file_path)" in pdf, 'PDF generation must download the stored evidence')
require('doc.embedPng(item.bytes)' in pdf and 'doc.embedJpg(item.bytes)' in pdf, 'PDF must embed PNG and JPEG evidence')
require("actor.branch_id !== visit.branch_id" in pdf, 'supervisor report access must be branch-scoped')
require("'مشرف الشفت', 'Supervisor', 'Shift Supervisor'" in pdf, 'supervisor report access must require a role-assigned action')
require("!['Morning', 'Evening', 'Both'].includes(actor.shift_type)" in pdf, 'supervisor report access must fail closed when the shift is missing or invalid')

migration = (ROOT / 'supabase/migrations/20261115160000_supervisor_visit_action_read.sql').read_text()
require("current_user_role() = 'Supervisor'" in migration, 'action read policy must require Supervisor role')
require('branch_id = current_user_branch_id()' in migration, 'action read policy must be scoped to the current branch')
require('shift_type = (SELECT p.shift_type FROM public.profiles AS p WHERE p.id = auth.uid())' in migration, 'action read policy must be scoped to the supervisor shift')

dashboard = (ROOT / 'supervisor-dashboard/index.html').read_text()
require('visit_action_items' in dashboard and 'visit-actions-list' in dashboard, 'supervisor dashboard must display assigned visit actions')
require('visit-report-pdf' in dashboard, 'supervisor dashboard must provide visit report access')
require('لا توجد مخالفات أو تكليفات مفتوحة' in dashboard, 'supervisor dashboard must show an empty state')

config = (ROOT / 'assets/supabase-config.js').read_text()
require("role === 'Supervisor' ? 'تقرير مشرف الشفت'" in config, 'supervisor navigation must label its shift report clearly')
report = (ROOT / 'daily-report/index.html').read_text()
require("currentUser.role === 'Supervisor'" in report and 'currentUser.shift_type' in report, 'daily report must default to the supervisor shift')

for relative in ['branch-visits-history/index.html', 'supervisor-dashboard/index.html', 'daily-report/index.html']:
    parser = InlineScripts()
    parser.feed((ROOT / relative).read_text())
    for index, source in enumerate(parser.scripts):
        with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8') as temp:
            temp.write(source)
            temp.flush()
            result = subprocess.run(['node', '--check', temp.name], text=True, capture_output=True)
            require(result.returncode == 0, f'JavaScript syntax error in {relative} inline script {index + 1}: {result.stderr}')

print('PASS: visit attachments print/PDF, branch-scoped supervisor report access, supervisor actions, and inline JavaScript syntax')
