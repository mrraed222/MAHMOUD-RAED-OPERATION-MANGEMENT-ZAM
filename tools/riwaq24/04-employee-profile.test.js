const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../employee-profile/index.html'), 'utf8');

test('profile hierarchy presents identity, contact, seven-day performance, then eligible reports', () => {
  const positions = ['id="p-name"', 'id="contact-heading"', 'id="performance-heading"', 'id="reports-heading"'].map(x => source.indexOf(x));
  assert.ok(positions.every(x => x >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(source, /حتى 10 تقارير/);
  assert.match(source, /role="status"/);
});

test('session, avatar storage and seven-day/report query contracts are preserved', () => {
  assert.match(source, /ZamSession\.requireAuth\('\.\.\/index\.html'\)/);
  assert.match(source, /storage\.from\('avatars'\)\.upload\(path, file, \{ upsert: true \}\)/);
  assert.match(source, /from\('profiles'\)\.update\(\{ avatar_url: data\.publicUrl \}\)\.eq\('id', currentUser\.id\)/);
  assert.match(source, /from\('checklist_logs'\)[\s\S]*?\.select\('id'\)[\s\S]*?\.eq\('executed_by', currentUser\.id\)[\s\S]*?\.gte\('execution_date'/);
  assert.match(source, /from\('daily_reports'\)[\s\S]*?\.eq\('supervisor_name', currentUser\.full_name\)[\s\S]*?\.order\('report_date', \{ ascending: false \}\)[\s\S]*?\.limit\(10\)/);
  assert.match(source, /\['Owner', 'Admin', 'Supervisor'\]\.includes\(currentUser\.role\)/);
});

test('independent loading, empty, error and retry states are exposed accessibly', () => {
  assert.match(source, /id="retry-performance-btn"/);
  assert.match(source, /addEventListener\('click', loadPerformance\)/);
  assert.match(source, /تعذّر تحميل الأداء/);
  assert.match(source, /لا توجد تقارير مرسلة بعد/);
  assert.match(source, /تعذّر تحميل التقارير/);
  assert.match(source, /onclick="loadMyReports\(\)"/);
  assert.match(source, /aria-busy/);
});
