const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const lifecycle = require('../assets/branch-lifecycle.js');
const root = path.join(__dirname, '..');

test('legacy branches with NULL status retain current behavior', () => {
  assert.equal(lifecycle.isOperational({ id: 'old', lifecycle_status: null }, '2026-11-17'), true);
  assert.equal(lifecycle.isOperational({ id: 'old' }, '2026-11-17'), true);
  assert.equal(lifecycle.label({ id: 'old', lifecycle_status: null }), 'حالة غير مصنفة — السلوك الحالي');
});

test('planned branches without a confirmed opening date stay inactive', () => {
  assert.equal(lifecycle.isOperational({ lifecycle_status: 'planned', planned_opening_date: null }, '2026-11-17'), false);
  assert.equal(lifecycle.isOperational({ lifecycle_status: 'planned' }, '2026-11-17'), false);
  assert.equal(lifecycle.label({ lifecycle_status: 'planned' }, '2026-11-17'), 'غير نشط — بلا تاريخ افتتاح');
});

test('planned branches remain inactive after their planned opening date until owner confirmation', () => {
  const branch = { lifecycle_status: 'planned', planned_opening_date: '2026-11-18' };
  assert.equal(lifecycle.isOperational(branch, '2026-11-17'), false);
  assert.equal(lifecycle.isOperational(branch, '2026-11-18'), false);
  assert.equal(lifecycle.isOperational(branch, '2026-11-19'), false);
  assert.equal(lifecycle.label(branch, '2026-11-18'), 'قيد التجهيز — تاريخ افتتاح مخطط 2026-11-18');
});

test('explicitly operational branches are active and unknown states fail closed', () => {
  assert.equal(lifecycle.isOperational({ lifecycle_status: 'operational', planned_opening_date: '2099-01-01' }, '2026-11-17'), true);
  assert.equal(lifecycle.isOperational({ lifecycle_status: 'archived' }, '2026-11-17'), false);
  assert.equal(lifecycle.isOperational(null, '2026-11-17'), false);
});

test('instant date resolution uses Asia/Riyadh', () => {
  const beforeRiyadhMidnight = new Date('2026-11-16T20:59:59.000Z');
  const atRiyadhMidnight = new Date('2026-11-16T21:00:00.000Z');
  const branch = { lifecycle_status: 'planned', planned_opening_date: '2026-11-17' };
  assert.equal(lifecycle.riyadhDateString(beforeRiyadhMidnight), '2026-11-16');
  assert.equal(lifecycle.isOperational(branch, beforeRiyadhMidnight), false);
  assert.equal(lifecycle.riyadhDateString(atRiyadhMidnight), '2026-11-17');
  assert.equal(lifecycle.isOperational(branch, atRiyadhMidnight), false);
});

test('reporting filters fail closed for records without a known operational branch', () => {
  const analytics = fs.readFileSync(path.join(root, 'analytics', 'index.html'), 'utf8');
  const logs = fs.readFileSync(path.join(root, 'checklist-logs', 'index.html'), 'utf8');
  const weekly = fs.readFileSync(path.join(root, 'assets', 'weekly-report-core.js'), 'utf8');
  assert.match(analytics, /if \(!id\) return false;[\s\S]*?if \(!branch\) return false;/);
  assert.match(logs, /if \(!row\?\.branch_id\) return false;/);
  assert.match(weekly, /function branchOperationalOnDate\(branch, date\) \{\s*if \(!branch\) return false;/);
  assert.match(weekly, /function branchesForPeriod\(r\)[\s\S]*?return BRANCHES\.filter\(function \(branch\) \{ return branchOperationalOnDate\(branch, endDate\); \}\)/);
});
