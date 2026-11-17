const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const receiving = require('../assets/inventory-receiving.js');

const project = path.resolve(__dirname, '..');
const validUuid = '11111111-2222-4333-8444-555555555555';
const validPhoto = { type: 'image/jpeg', size: 1024, name: 'receipt.jpg', lastModified: 1 };

test('delivery-note photo accepts supported formats and enforces size limits', () => {
  assert.equal(receiving.validateReceiptPhoto(validPhoto), 'jpg');
  assert.equal(receiving.validateReceiptPhoto({ ...validPhoto, type: 'image/png' }), 'png');
  assert.equal(receiving.validateReceiptPhoto({ ...validPhoto, type: 'image/webp' }), 'webp');
  assert.throws(() => receiving.validateReceiptPhoto(null), /أرفق صورة/);
  assert.throws(() => receiving.validateReceiptPhoto({ ...validPhoto, type: 'image/gif' }), /نوع الصورة/);
  assert.throws(() => receiving.validateReceiptPhoto({ ...validPhoto, size: 0 }), /أكبر من صفر/);
  assert.throws(() => receiving.validateReceiptPhoto({ ...validPhoto, size: receiving.MAX_RECEIPT_PHOTO_BYTES + 1 }), /10 ميجابايت/);
});

test('arrival path is scoped to branch, request, and idempotency key', () => {
  assert.equal(
    receiving.receiptPhotoPath(validUuid, validUuid, validUuid, validPhoto),
    `${validUuid}/${validUuid}/${validUuid}.jpg`
  );
  assert.throws(() => receiving.receiptPhotoPath('bad', validUuid, validUuid, validPhoto), /معرّفات/);
});

test('partial and repeated arrivals preserve remaining quantity and reject oversupply', () => {
  const first = [{ request_item_id: 'item-a', product_name: 'Milk', requested_quantity: 5, received_quantity: 0 }];
  assert.deepEqual(receiving.buildArrivalItems(first, { 'item-a': '2' }), [
    { request_item_id: 'item-a', received_quantity: 2 }
  ]);
  assert.equal(receiving.remainingQuantity(5, 2), 3);
  const second = [{ ...first[0], received_quantity: 2 }];
  assert.deepEqual(receiving.buildArrivalItems(second, { 'item-a': '3' }), [
    { request_item_id: 'item-a', received_quantity: 3 }
  ]);
  assert.equal(receiving.remainingQuantity(5, 5), 0);
  assert.throws(() => receiving.buildArrivalItems(second, { 'item-a': '3.01' }), /تتجاوز المتبقي/);
  assert.throws(() => receiving.buildArrivalItems(second, { 'item-a': '-1' }), /كمية صحيحة/);
  assert.throws(() => receiving.buildArrivalItems(second, { 'item-a': '' }), /كمية مستلمة واحدة على الأقل/);
});

test('each arrival portion has its own exact 20-minute deadline and overdue state', () => {
  const receivedAt = '2026-11-17T18:00:00.000Z';
  const onDeadline = receiving.deadlineState(receivedAt, '2026-11-17T18:20:00.000Z');
  assert.equal(onDeadline.deadlineAt, '2026-11-17T18:20:00.000Z');
  assert.equal(onDeadline.overdue, false);
  assert.equal(onDeadline.remainingMs, 0);
  const late = receiving.deadlineState(receivedAt, '2026-11-17T18:20:01.000Z');
  assert.equal(late.overdue, true);
  assert.equal(late.remainingMs, 0);
  assert.equal(receiving.deadlineState('2026-11-17T18:03:00Z', '2026-11-17T18:23:00Z').deadlineAt, '2026-11-17T18:23:00.000Z');
  assert.throws(() => receiving.deadlineState('not a date'), /تاريخ الاستلام/);
});

test('same idempotency fingerprint reuses a key, changed arrivals get a new key', () => {
  const existing = { key: validUuid, fingerprint: 'same-arrival' };
  assert.equal(receiving.reuseOrCreateIdempotencyDraft(existing, 'same-arrival', () => 'unused'), existing);
  const changed = receiving.reuseOrCreateIdempotencyDraft(existing, 'different-quantity-or-photo', () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(changed.key, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(changed.fingerprint, 'different-quantity-or-photo');
  assert.throws(() => receiving.reuseOrCreateIdempotencyDraft(null, 'x', () => 'bad'), /غير صالح/);
});

test('photo digest distinguishes different image bytes even when metadata matches', async () => {
  const file = bytes => ({
    type: 'image/jpeg',
    size: bytes.length,
    name: 'receipt.jpg',
    lastModified: 10,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  });
  const first = file([1, 2, 3, 4]);
  const second = file([1, 2, 3, 5]);
  assert.deepEqual(
    [first.type, first.size, first.name, first.lastModified],
    [second.type, second.size, second.name, second.lastModified]
  );
  const firstDigest = await receiving.receiptPhotoDigest(first, webcrypto.subtle);
  const secondDigest = await receiving.receiptPhotoDigest(second, webcrypto.subtle);
  assert.match(firstDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(firstDigest, secondDigest);
  const previous = { key: validUuid, fingerprint: JSON.stringify({ size: 4, type: 'image/jpeg', sha256: firstDigest }) };
  const changed = receiving.reuseOrCreateIdempotencyDraft(
    previous,
    JSON.stringify({ size: 4, type: 'image/jpeg', sha256: secondDigest }),
    () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  );
  assert.equal(changed.key, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
});

test('an already-uploaded receipt photo is treated as a retry, not as a failed upload', () => {
  assert.equal(receiving.isReceiptPhotoAlreadyUploaded({ statusCode: 409 }), true);
  assert.equal(receiving.isReceiptPhotoAlreadyUploaded({ error: 'Duplicate' }), true);
  assert.equal(receiving.isReceiptPhotoAlreadyUploaded({ message: 'Object already exists' }), true);
  assert.equal(receiving.isReceiptPhotoAlreadyUploaded({ statusCode: 400, message: 'bad request' }), false);
  assert.equal(receiving.isReceiptPhotoAlreadyUploaded(null), false);
});

test('completion requires item, quantity, expiry, package condition, and FIFO/FEFO', () => {
  const valid = {
    itemVerified: true,
    quantityVerified: true,
    expiryChecked: true,
    expiryDate: '2026-12-01',
    packageCondition: 'intact',
    packageNotes: '  ',
    storageMethod: 'FEFO'
  };
  const normalized = receiving.validateCompletionInput(valid);
  assert.equal(normalized.packageNotes, null);
  assert.equal(normalized.expiryDate, '2026-12-01');
  assert.throws(() => receiving.validateCompletionInput({ ...valid, expiryChecked: false }), /فحص الصلاحية/);
  assert.throws(() => receiving.validateCompletionInput({ ...valid, packageCondition: '' }), /حالة العبوة/);
  assert.throws(() => receiving.validateCompletionInput({ ...valid, packageCondition: 'damaged' }), /ملاحظة/);
  assert.throws(() => receiving.validateCompletionInput({ ...valid, storageMethod: 'none' }), /FIFO أو FEFO/);
  assert.throws(() => receiving.validateCompletionInput({ ...valid, expiryDate: '12/01/2026' }), /تاريخ انتهاء/);
  assert.equal(receiving.validateCompletionInput({ ...valid, packageCondition: 'compromised', packageNotes: 'وصلت مفتوحة' }).packageCondition, 'compromised');
});

test('only active supervisors at operational branches may see event receipt tasks', () => {
  assert.equal(receiving.canDisplaySupervisorReceivingTasks('Supervisor', 'active', true), true);
  assert.equal(receiving.canDisplaySupervisorReceivingTasks('Supervisor', 'inactive', true), false);
  assert.equal(receiving.canDisplaySupervisorReceivingTasks('Barista', 'active', true), false);
  assert.equal(receiving.canDisplaySupervisorReceivingTasks('Supervisor', 'active', false), false);
});

test('inventory UI records arrival rather than order creation and tasks are event-driven', () => {
  const inventoryPage = fs.readFileSync(path.join(project, 'inventory-requests/index.html'), 'utf8');
  const supervisorPage = fs.readFileSync(path.join(project, 'supervisor-checklist/index.html'), 'utf8');
  const migration = fs.readFileSync(path.join(project, 'supabase/migrations/20261117210000_inventory_receiving_events.sql'), 'utf8');
  const loginFunction = fs.readFileSync(path.join(project, 'supabase/functions/login-with-passcode/index.ts'), 'utf8');
  assert.match(inventoryPage, /id="receiving-section"/);
  assert.match(inventoryPage, /id="receipt-photo"[^>]+required/);
  assert.match(inventoryPage, /record_inventory_receipt/);
  assert.match(inventoryPage, /get_inventory_request_receiving_lines/);
  assert.match(inventoryPage, /currentUser\.role,\s*currentUser\.status,/);
  assert.match(supervisorPage, /id="inventory-receiving-tasks-section"/);
  assert.match(supervisorPage, /get_open_inventory_receipt_tasks/);
  assert.match(supervisorPage, /complete_inventory_receipt_item/);
  assert.match(supervisorPage, /currentUser\?\.role, currentUser\?\.status, true/);
  assert.match(supervisorPage, /setInterval\(\(\) => \{ if \(currentUser\?\.role === 'Supervisor'\) loadOpenReceivingTasks\(\); \}, 60 \* 1000\)/);
  assert.match(loginFunction, /select\('[^']*\bstatus\b[^']*'\)/);
  assert.match(inventoryPage, /photoDigest = await ZamInventoryReceiving\.receiptPhotoDigest\(file\)/);
  assert.match(inventoryPage, /sha256: photoDigest/);
  assert.match(inventoryPage, /upsert: false/);
  assert.match(inventoryPage, /isReceiptPhotoAlreadyUploaded\(uploadError\)/);
  const submitHandler = inventoryPage.slice(
    inventoryPage.indexOf("document.getElementById('receiving-form').addEventListener('submit'"),
    inventoryPage.indexOf("document.getElementById('request-form').addEventListener('submit'")
  );
  assert.match(submitHandler, /if \(button\.disabled\) return;[\s\S]*?button\.disabled = true;[\s\S]*?finally \{\s*button\.disabled = false;/);
  assert.match(submitHandler, /if \(!data\) throw[\s\S]*?تم تسجيل وصول[\s\S]*?catch \(refreshError\)[\s\S]*?لا تُعِد تسجيلها/);
  assert.match(migration, /storage_deadline_at timestamptz NOT NULL DEFAULT \(now\(\) \+ INTERVAL '20 minutes'\)/);
  assert.match(migration, /pg_catalog\.now\(\) > r\.storage_deadline_at/);
  assert.match(migration, /p_package_condition IS NULL/);
  assert.match(migration, /p_storage_method IS NULL/);
  assert.match(migration, /even if the retry body\/photo differs/i);
  assert.match(migration, /v_profile\.role IS DISTINCT FROM 'Supervisor'/);
  assert.match(migration, /v_profile\.status IS DISTINCT FROM 'active'/);
  assert.match(migration, /INSERT INTO storage\.buckets[\s\S]*?'inventory-receipts'[\s\S]*?false/);
  assert.match(migration, /CREATE POLICY inventory_receipts_object_upload[\s\S]*?FOR INSERT TO authenticated[\s\S]*?can_access_inventory_receipt_object\(name, true\)/);
  assert.match(migration, /CREATE POLICY inventory_receipts_object_read[\s\S]*?FOR SELECT TO authenticated[\s\S]*?can_access_inventory_receipt_object\(name, false\)/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON public\.inventory_receipts, public\.inventory_receipt_items FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /Receiving schema preflight failed/);
  assert.doesNotMatch(migration, /DROP FUNCTION|DROP POLICY/i);
});
