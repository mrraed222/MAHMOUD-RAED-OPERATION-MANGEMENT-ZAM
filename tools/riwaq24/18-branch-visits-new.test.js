const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../branch-visits-new/index.html'), 'utf8');

test('visit page preserves auth, assignment permissions, versioning and backend payload contracts', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /renderZamSidebar\('branch-visits', currentUser\.role\)/);
  assert.match(source, /data-zam-header-tools/);
  assert.match(source, /zamClient\.rpc\('can_manage_branch_visits'\)/);
  assert.match(source, /zamClient\.rpc\('complete_branch_visit_assignment', \{p_assignment_id: activeAssignmentId\}\)/);
  assert.match(source, /zamClient\.rpc\('list_branch_visit_assignees', \{p_branch_id: branchId\}\)/);
  assert.match(source, /zamClient\.from\('visit_checklist_templates'\)/);
  assert.match(source, /assessment_version: activeAssessmentVersion/);
  assert.match(source, /onConflict: 'visit_id,item_id'/);
  assert.match(source, /assignment_id: activeAssignmentId/);
  assert.ok(source.includes('async function stableEvidencePath(actionId, uploaderId, file)'));
  assert.ok(source.includes('return `${actionId}/${uploaderId}/${fingerprint}-${safeName}`;'));
  assert.match(source, /stableEvidencePath\(actionId, currentUser\.id, file\)/);
  assert.match(source, /status: activeAssignmentId \? 'مسودة' : 'معتمدة'/);
  assert.match(source, /يوجد تقرير معتمد لهذا التكليف/);
});

test('visit workflow presents clear stages, accessible progress and real loading/empty/error feedback', () => {
  assert.match(source, /aria-label="مراحل الزيارة"/);
  assert.match(source, /href="#visit-context"/);
  assert.match(source, /href="#assessmentHeading"/);
  assert.match(source, /href="#signoffHeading"/);
  assert.match(source, /id="items"[^>]*aria-live="polite" aria-busy="true"/);
  assert.match(source, /items\.setAttribute\('aria-busy', 'false'\)/);
  assert.match(source, /لا توجد معايير مطابقة للفرع والشفت/);
  assert.match(source, /تعذر تهيئة صلاحيات أو بيانات الزيارة/);
  assert.match(source, /id="progress" aria-live="polite"/);
  assert.match(source, /role="group" aria-label="درجة المعيار"/);
  assert.match(source, /prefers-reduced-motion:reduce/);
});

test('new-visit header wraps without overlap and omits the notification control', () => {
  assert.match(source, /<header class="brand p-6">/);
  assert.match(source, /<h1 class="text-3xl font-black">تسجيل زيارة فرع<\/h1>/);
  assert.match(source, /header\.brand>\.max-w-5xl\{width:min\(100%,1120px\);flex-wrap:wrap\}/);
  assert.match(source, /@media\(max-width:700px\).*header\.brand nav\{width:100%;justify-content:flex-start\}/);
  assert.doesNotMatch(source, /notif-bell-slot|إشعارات/);
});

test('visit page retains separate assignment and assessment actions and responsive task layout', () => {
  assert.match(source, /id="assignmentForm"/);
  assert.match(source, /id="useAssignment"/);
  assert.match(source, /id="form" class="space-y-5"/);
  assert.match(source, /id="save"[^>]*type="submit"/);
  assert.match(source, /@media\(max-width:700px\)/);
  assert.match(source, /id="confirmEval" type="checkbox"/);
  assert.match(source, /يجب إرفاق صورة لكل مخالفة/);
});
