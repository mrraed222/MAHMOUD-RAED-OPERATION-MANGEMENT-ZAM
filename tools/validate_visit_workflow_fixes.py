from html.parser import HTMLParser
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


class InlineScripts(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts = []
        self._current = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'script':
            attrs = dict(attrs)
            self._current = [] if 'src' not in attrs else None

    def handle_data(self, data):
        if self._current is not None:
            self._current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == 'script' and self._current is not None:
            source = ''.join(self._current).strip()
            if source:
                self.scripts.append(source)
            self._current = None


def require(condition, message):
    if not condition:
        raise AssertionError(message)


history = (ROOT / 'branch-visits-history/index.html').read_text()
print_fn = history[history.index('async function printVisit(id){'):history.index('apply.onclick=load;')]
require("from('visit_evidence')" in print_fn, 'direct printing must read visit evidence')
require('createSignedUrl(item.file_path,600)' in print_fn, 'direct printing must use temporary evidence URLs')
require('class="attachments"' in print_fn and 'المرفقات' in print_fn, 'direct printing must render an attachments section')
require('window.print()' in print_fn, 'direct printing must trigger the print dialog after page load')
require("rpc('can_manage_branch_visits')" in history, 'history controls must use the server permission')
require("rpc('can_view_branch_visit_reports')" in history, 'history must check view access with the server')

pdf = (ROOT / 'supabase/functions/visit-report-pdf/index.ts').read_text()
require("storage.from('task-evidence').download(item.file_path)" in pdf, 'PDF generation must download stored evidence')
require('doc.embedPng(item.bytes)' in pdf and 'doc.embedJpg(item.bytes)' in pdf, 'PDF must embed PNG and JPEG evidence')
require("rpc('can_access_branch_visit'" in pdf, 'PDF authorization must be scoped to the specific visit assignment')
require("rpc('can_manage_branch_visits')" in pdf, 'email sending must require the visit management permission')
require("if (sendEmail && !canManageVisits)" in pdf, 'assigned workers may download but must not email reports')
require('allowedRoles' not in pdf, 'PDF access must not depend on a separate hard-coded role allow-list')

migration = (ROOT / 'supabase/migrations/20261115172000_branch_visit_assignments_and_15_criteria.sql').read_text()
criteria = re.findall(r"\('BRV-[A-Z]+-\d{2}'", migration)
require(len(criteria) == 15, f'new checklist must have exactly 15 scored criteria, found {len(criteria)}')
require('UPDATE public.visit_checklist_templates' in migration and 'AND code IN (' in migration, 'only known built-in templates may be archived')
legacy_codes = re.findall(r"'([A-Z][A-Z0-9-]+)'", migration[migration.index('AND code IN ('):migration.index(');', migration.index('AND code IN ('))])
require(len(legacy_codes) == 34, f'exactly the 34 legacy built-in checks should be archived, found {len(legacy_codes)}')
require('ON CONFLICT (code) DO UPDATE' in migration, 'checklist migration must be safe to re-run')
for phrase in ['كراسي والطاولات', 'الأرضيات داخل الفرع وخارجه', 'درجة حرارة المكيف', 'نظافة البار', 'نظافة المطبخ', 'بطاقات العمل', 'نظام الولاء', 'سرعة تجهيز الطلب', 'انقطاعات', 'FIFO', 'FEFO', 'المهام الإدارية', 'الدفاع المدني', 'اشتراطات البلدية', 'سلامة الغذاء', 'GMP']:
    require(phrase in migration, f'assessment must retain requested subcheck: {phrase}')
require('CREATE TABLE IF NOT EXISTS public.branch_visit_assignments' in migration, 'a first-class visit assignment table must exist')
require('assigned_to uuid NOT NULL REFERENCES public.profiles(id)' in migration, 'visit assignment must identify one employee')
require('assignment_id uuid' in migration and 'can_submit_assigned_branch_visit' in migration, 'assigned employee must be scoped to the matching branch/date/shift')
require('CREATE POLICY supervisory_visits_insert' in migration, 'database must authorize visit creation for the assigned user')
require('CREATE POLICY visit_results_write' in migration, 'database must authorize result writes only for management or that visit assignee')
require('complete_branch_visit_assignment' in migration, 'completed visit must close its assignment through guarded finalization')
require('DROP TRIGGER IF EXISTS complete_branch_visit_assignment_after_insert' in migration, 'assignment must not close before report results and actions are saved')
require('CREATE OR REPLACE FUNCTION public.complete_branch_visit_assignment(p_assignment_id uuid)' in migration, 'assignment completion must be an authorized finalization step')
require('can_manage_branch_visits boolean NOT NULL DEFAULT false' in migration, 'new admin permission must default to least privilege')
submit_fn = migration[migration.index('CREATE OR REPLACE FUNCTION public.can_submit_assigned_branch_visit'):migration.index('DROP TRIGGER IF EXISTS complete_branch_visit_assignment_after_insert')]
require("p.status = 'active'" in submit_fn and 'a.assigned_to = p.id' in submit_fn, 'submission must require the assigned, active profile')
require('REFERENCES public.profiles(id) ON DELETE RESTRICT' in migration, 'deleting a profile must not erase assignment audit history')
require('DROP POLICY IF EXISTS branch_visit_assignments_delete' in migration and 'CREATE POLICY branch_visit_assignments_delete' not in migration, 'assignment audit history must not be deletable through the app')
require('DROP POLICY IF EXISTS branch_visit_assignments_update' in migration and 'CREATE POLICY branch_visit_assignments_update' not in migration, 'assignment status and history must only change through the guarded server finalizer')
require('ADD COLUMN IF NOT EXISTS subchecks jsonb' in migration, 'subchecks must be stored for later audit')
require("'GOV-FIRE','GOV-EQUIPMENT','GOV-MUNICIPAL','GOV-FOOD','GOV-GMP'" in migration, 'all five government checks must be validated individually')
require("jsonb_array_length(r.subchecks) <> 5" in migration and 'round(avg(CASE WHEN check_row->>' in migration, 'government subchecks must all be completed and reflected in their aggregate score')
require("ai.assigned_to IS NOT NULL" in migration and "e.uploaded_by = auth.uid()" in migration, 'finalization must require assigned corrective actions and evidence')
require("criteria_count <> 15" in migration and 'r.result = \'غير مكتمل\'' in migration, 'server finalization must require all 15 active criteria, not just one result')
require('client_key text' in migration and 'visit_action_items_visit_client_key_unique' in migration and 'visit_evidence_visit_client_key_unique' in migration, 'draft retries must have database idempotency keys')
require("status = 'مسودة'" in migration and 'signed_by IS NULL' in migration, 'assigned users may only insert/update unsigned drafts')

visit_page = (ROOT / 'branch-visits-new/index.html').read_text()
require("rpc('can_manage_branch_visits')" in visit_page, 'assignment management must check the live permission')
require("rpc('list_branch_visit_assignees'" in visit_page, 'assignees must be selected from active branch profiles')
require("from('branch_visit_assignments').insert" in visit_page, 'managers must be able to create explicit assignments')
require(".in('code', BRANCH_VISIT_CODES)" in visit_page, 'the standard form must stay capped at the official 15 criteria without deleting custom templates')
require("assignment_id: activeAssignmentId" in visit_page, 'visit report must retain the exact assignment ID')
require('لا يمكن اعتماد تقرير دون تكليف زيارة مسند لحسابك' in visit_page, 'unassigned users must not create assigned-worker reports')
require('اختر موظفاً مسؤولاً لكل مخالفة' in visit_page, 'corrective actions must not be left with a fictitious role only')
require(".upsert(resultRows, {onConflict: 'visit_id,item_id'})" in visit_page, 'result retries must update their existing rows')
require(".upsert(actionRows, {onConflict: 'visit_id,client_key'})" in visit_page, 'action retries must update their existing rows')
require(".upsert(evidenceRows, {onConflict: 'visit_id,client_key'})" in visit_page and "upload(path, file, {upsert: false})" in visit_page, 'evidence retries must upsert the evidence row with a stable object path')
require('stableEvidencePath(visitId, itemId, file)' in visit_page and 'isDuplicateEvidenceUpload' in visit_page, 'a retry after successful upload but failed database save must reuse the same content-addressed file')
require("card.querySelectorAll('.score:not(.subcheck-score)')" in visit_page and "card.querySelector('.score.selected:not(.subcheck-score)')" in visit_page, 'government subchecks must not be mistaken for the parent score or clear each other')
require('choices.length !== GOVERNMENT_CHECKS.length' in visit_page and "card.querySelectorAll('.subcheck-score.selected')" in visit_page, 'the government criterion must remain unscored until all five subchecks are selected')
require('async function loadAssignmentDraft(task)' in visit_page and "eq('assignment_id', task.id).maybeSingle()" in visit_page, 'a failed report must be recoverable after reload')
require("rpc('complete_branch_visit_assignment'" in visit_page and visit_page.index("rpc('complete_branch_visit_assignment'") > visit_page.index(".upsert(evidenceRows"), 'assignment finalization must occur after draft data and evidence are saved')
require(visit_page.index("rpc('complete_branch_visit_assignment'") > visit_page.index('if (evidenceError) throw evidenceError;'), 'assignment must close after the report results and evidence have been saved')
stamp = 'اعتماد إلكتروني — محمود شريف — إدارة التشغيل'
require(stamp in visit_page, 'visit signing screen must show the exact requested electronic stamp')
require(stamp in history and 'r.subchecks' in history, 'history/print must show the exact stamp and separate government checks')
require(stamp in pdf and 'result.subchecks' in pdf, 'downloaded PDF must show the exact stamp and separate government checks')
require(pdf.rindex(stamp) > pdf.index('if (evidence.length)'), 'PDF electronic approval must appear at the end after report details and evidence')

workflow = (ROOT / 'supabase/migrations/20261115160000_supervisor_visit_action_read.sql').read_text()
require("current_user_role() = 'Supervisor'" in workflow, 'legacy supervisor action read must remain role-scoped')
require('branch_id = current_user_branch_id()' in workflow, 'legacy supervisor access must remain branch-scoped')
require('shift_type = (SELECT p.shift_type FROM public.profiles AS p WHERE p.id = auth.uid())' in workflow, 'legacy supervisor access must remain shift-scoped')

dashboard = (ROOT / 'supervisor-dashboard/index.html').read_text()
require('visit_action_items' in dashboard and 'visit-actions-list' in dashboard, 'supervisor dashboard must display visit actions')
require('visit-report-pdf' in dashboard, 'supervisor dashboard must provide report access')
require('لا توجد مخالفات أو تكليفات مفتوحة' in dashboard, 'supervisor dashboard must show an empty state')

config = (ROOT / 'assets/supabase-config.js').read_text()
require("href: 'branch-visits-new/index.html'" in config and "'Kitchen', 'Waiter'" in config, 'assigned users of any operational role must reach their tasks')
require("['Admin', 'Supervisor', 'Manager', 'Quality', 'Quality Manager'].includes(me.role)" in config, 'permission helper must accept quality roles')
permissions = (ROOT / 'permissions/index.html').read_text()
require("key: 'can_manage_branch_visits'" in permissions, 'owner permission editor must expose visit assignment control')

report = (ROOT / 'daily-report/index.html').read_text()
require("currentUser.role === 'Supervisor'" in report and 'currentUser.shift_type' in report, 'daily report must retain the prior supervisor shift default')

for relative in ['branch-visits-new/index.html', 'branch-visits-history/index.html', 'supervisor-dashboard/index.html', 'daily-report/index.html']:
    parser = InlineScripts()
    parser.feed((ROOT / relative).read_text())
    for index, source in enumerate(parser.scripts):
        with tempfile.NamedTemporaryFile('w', suffix='.js', encoding='utf-8') as temp:
            temp.write(source)
            temp.flush()
            result = subprocess.run(['node', '--check', temp.name], text=True, capture_output=True)
            require(result.returncode == 0, f'JavaScript syntax error in {relative} inline script {index + 1}: {result.stderr}')

print('PASS: 15 assessment criteria preserve requested checks; assignment-scoped RLS, task workflow, PDF access and inline JavaScript validated')
