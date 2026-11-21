const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../../register/index.html'), 'utf8');

test('registration retains identity, role mapping, upload bucket/path, and API payload contract', () => {
  for (const field of ['full_name', 'employee_number', 'email', 'whatsapp_number', 'passcode', 'role', 'branch_id', 'avatar_url']) assert.match(html, new RegExp(`\\b${field}\\b`));
  assert.match(html, /registerEmployee\(\{/);
  assert.match(html, /ROLE_MAP/);
  assert.match(html, /storage\.from\('avatars'\)/);
  assert.match(html, /pending\/\$\{Date\.now\(\)\}/);
  assert.match(html, /'Shift Supervisor': 'Supervisor'/);
});

test('form provides ordered steps, optional avatar, required fields and review-acceptance context', () => {
  assert.match(html, /خطوات طلب التسجيل/);
  assert.match(html, /href="#identity-heading"/);
  assert.match(html, /href="#work-heading"/);
  assert.match(html, /href="#security-heading"/);
  assert.match(html, /الصورة اختيارية/);
  assert.match(html, /مراجعة الإدارة مطلوبة/);
  assert.match(html, /العودة إلى تسجيل الدخول/);
});

test('branch loading, empty and failure states are explicit and retryable', () => {
  assert.match(html, /جارٍ تحميل قائمة الفروع/);
  assert.match(html, /لا توجد فروع متاحة للاختيار/);
  assert.match(html, /تعذر تحميل قائمة الفروع/);
  assert.match(html, /addEventListener\('click', loadBranchOptions/);
  assert.match(html, /select\.disabled = true/);
  assert.match(html, /select\.disabled = false/);
});

test('inline scripts parse successfully', () => {
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(Boolean);
  assert.ok(scripts.length);
  for (const script of scripts) new vm.Script(script);
});
