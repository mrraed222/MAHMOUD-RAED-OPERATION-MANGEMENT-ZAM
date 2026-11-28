const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../checklist-logs/index.html'), 'utf8');

test('checklist log preserves auth/role guards and existing read sources and filters', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /\['Owner','Admin','Manager','Supervisor'\]\.includes\(currentUser\.role\)/);
  for (const api of ['getBranches', 'getChecklistLogs', 'getHourlyChecklistLogs', 'getTeamNotes', 'getFridgeReadings']) {
    assert.match(source, new RegExp(`ZamAPI\\.${api}\\(`));
  }
  assert.match(source, /ZamBranchLifecycle\.isOperational\(branch, row\.execution_date/);
  assert.match(source, /currentUser\.role === 'Supervisor'/);
  for (const id of ['f-branch', 'f-date', 'f-shift']) assert.match(source, new RegExp(`id="${id}"`));
});

test('single completed-execution table merges notes independently and keeps secure, accessible photo zoom', () => {
  assert.match(source, /function safeImageUrl\(/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /id="table-view" class="max-h-\[560px\] overflow-auto/);
  assert.doesNotMatch(source, /id="gallery-view"|id="tab-gallery"|id="hourly-logs-tbody"|id="team-notes-list"/);
  assert.match(source, /إعادة المحاولة/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /loading="lazy"/);
  assert.match(source, /const completedLogs = logs\.filter\(ZamChecklistLogMetrics\.isCompleted\)/);
  assert.match(source, /const hourlyCompletedLogs = hourlyLogs\.filter\(ZamChecklistLogMetrics\.isCompleted\)/);
  assert.match(source, /executionRows\.length \? executionRows\.map/);
  assert.match(source, /ملاحظة فريق عامة — غير مرتبطة بمهمة/);
  assert.match(source, /const taskTitle = isNote \? '—'/, 'a note without a task link must not be attributed to a task');
  assert.match(source, /class="checklist-photo-trigger zoomable-btn" data-src=/);
  assert.match(source, /id="branch-shift-summary" class="checklist-counter-grid"/);
  assert.match(source, /summarizeHourlyExecutionCounts\(allHourlyLogs, hourlyTaskBranches\)/,
    'branch counters must include both shifts and only branches with applicable hourly templates');
  assert.match(source, /ZamAPI\.getTemplates\(null, null, branch\.id\)/);
  assert.match(source, /isHourlyTemplateApplicableInBranch/);
  assert.match(source, /الوردية الصباحية[\s\S]*?الوردية المسائية/);
  assert.match(source, /قراءات حرارة الثلاجات والفريزرات/, 'the unrelated fridge-reading table remains available');
});

test('checklist log section and table headings describe the records and displayed fields', () => {
  assert.match(source, /<h1 class="font-title-md text-title-md text-primary">سجل تنفيذ المهام والصور<\/h1>/);
  assert.match(source, /<h2 id="scope-heading">فلاتر السجل<\/h2>/);
  assert.match(source, /<h2 id="results-heading">تفاصيل التنفيذ وملاحظات الفريق<\/h2>/);
  assert.match(source, /<h2 id="branch-shift-summary-heading">ملخص المهام الساعية حسب الفرع والوردية<\/h2>/);
  assert.doesNotMatch(source, /يعرض الجدول المهام المكتملة وملاحظات الفريق/);
  assert.doesNotMatch(source, /تعرض كل بطاقة الوردية الصباحية والمسائية معًا/);
  assert.match(source, /تاريخ ووقت التنفيذ \/ التسجيل[\s\S]*?الفرع[\s\S]*?نوع السجل[\s\S]*?اسم المهمة[\s\S]*?الفئة \/ الخطوات المنفذة[\s\S]*?الوردية[\s\S]*?المنفذ \/ مسجّل الملاحظة[\s\S]*?ملاحظات التنفيذ \/ الفريق[\s\S]*?صورة الإثبات/);
  assert.match(source, /<h2 class="font-title-md text-primary">سجل قراءات حرارة الثلاجات والفريزرات<\/h2>/);
  assert.match(source, /تاريخ ووقت القراءة[\s\S]*?درجة الحرارة[\s\S]*?ملاحظة القراءة/);
});
test('all inline JavaScript parses', () => {
  const scripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  for (const [index, match] of scripts.entries()) {
    if (match[1].trim()) assert.doesNotThrow(() => new vm.Script(match[1]), `inline script ${index + 1}`);
  }
});
