const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../inventory-requests/index.html'), 'utf8');

test('inventory requests preserves auth, permission, branch scope and role behavior', () => {
  for (const contract of [
    "ZamSession.requireAuth('../index.html')",
    "from('admin_permissions')",
    "select('can_manage_inventory,can_view_all_inventory,inventory_branch_ids')",
    "currentUser.role === 'Owner'",
    "isSupervisor && currentUser.branch_id",
    "ZamBranchLifecycle.isOperational",
    "zamRoleHomePath(currentUser.role)",
    "from('branches')",
    'inventoryAccess.canCreate',
    'inventoryAccess.canReceive'
  ]) assert.ok(source.includes(contract), `missing access contract: ${contract}`);
});

test('request and receipt flows preserve exact RPC payloads, supported suppliers and safety limits', () => {
  for (const contract of [
    "['المعمل', 'المستودع', 'مشتريات مباشرة']",
    'itemsList.children.length >= 50',
    "rpc('create_inventory_request'",
    'p_supplier: supplier',
    'p_shift_type: selectedShift',
    'p_items: items',
    "rpc('get_inventory_request_receiving_lines'",
    "rpc('record_inventory_receipt'",
    'p_idempotency_key: draft.key',
    'p_receipt_photo_path: photoPath',
    'p_items: arrivalItems',
    'ZamInventoryReceiving.reuseOrCreateIdempotencyDraft',
    "from('inventory-receipts').upload",
    'loadReceivingRequests()',
    '.limit(50)'
  ]) assert.ok(source.includes(contract), `missing workflow contract: ${contract}`);
});

test('page keeps supplier, item and receiving details accessible and tells the truth about scope', () => {
  for (const label of ['جهة التوريد الداخلية', 'اسم المنتج', 'الكمية الحالية', 'الكمية المطلوبة', 'وحدة التخزين / الطلب', 'الاحتياج', 'صورة سند التسليم / الاستلام']) assert.ok(source.includes(label));
  assert.match(source, /لا ينشأ عند إنشاء الطلب/);
  assert.match(source, /حد التخزين البالغ 20 دقيقة/);
  assert.match(source, /FIFO\/FEFO/);
  assert.match(source, /id="history-branch-filter"/);
  assert.match(source, /aria-live="polite" aria-busy="true"/);
  assert.match(source, /لا توجد طلبات محفوظة/);
  assert.match(source, /إعادة تحميل السجل/);
});

test('saved order history remains limited to the current authorized scope and supports review/print/share', () => {
  assert.match(source, /query\.in\('branch_id', inventoryAccess\.branchIds\)/);
  assert.match(source, /query\.limit\(50\)/);
  assert.match(source, /عرض وطباعة/);
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /https:\/\/wa\.me\/\?text=/);
  assert.match(source, /renderOrderPreview\(requestResult\.data, itemsResult\.data/);
});

test('notification bell is not duplicated locally; shared header owns it and inline scripts parse', () => {
  assert.equal((source.match(/renderNotificationBell\(\)/g) || []).length, 0);
  assert.doesNotMatch(source, /notif-bell-slot/);
  const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});
