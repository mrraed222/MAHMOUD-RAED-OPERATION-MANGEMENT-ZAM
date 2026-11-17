(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ZamInventoryReceiving = Object.freeze(api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_RECEIPT_PHOTO_BYTES = 10 * 1024 * 1024;
  const PHOTO_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  });
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STORAGE_WINDOW_MS = 20 * 60 * 1000;

  function validateReceiptPhoto(file) {
    if (!file || typeof file !== 'object') throw new Error('أرفق صورة سند الاستلام.');
    const extension = PHOTO_EXTENSIONS[String(file.type || '').toLowerCase()];
    if (!extension) throw new Error('نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WebP.');
    if (!Number.isFinite(Number(file.size)) || Number(file.size) <= 0 || Number(file.size) > MAX_RECEIPT_PHOTO_BYTES) {
      throw new Error('يجب أن تكون صورة السند أكبر من صفر وألا تتجاوز 10 ميجابايت.');
    }
    return extension;
  }

  async function receiptPhotoDigest(file, subtle = globalThis.crypto?.subtle) {
    if (!file || typeof file.arrayBuffer !== 'function') throw new Error('تعذّر قراءة صورة سند الاستلام.');
    if (!subtle || typeof subtle.digest !== 'function') throw new Error('المتصفح لا يدعم التحقق الآمن من صورة السند.');
    const bytes = new Uint8Array(await subtle.digest('SHA-256', await file.arrayBuffer()));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function isReceiptPhotoAlreadyUploaded(error) {
    if (!error) return false;
    return Number(error.statusCode) === 409
      || String(error.error || '').toLowerCase() === 'duplicate'
      || /already exists|duplicate/i.test(String(error.message || ''));
  }

  function remainingQuantity(requestedQuantity, receivedQuantity) {
    const requested = Number(requestedQuantity);
    const received = Number(receivedQuantity || 0);
    if (!Number.isFinite(requested) || requested < 0 || !Number.isFinite(received) || received < 0) {
      throw new Error('تعذّر التحقق من الكميات المسجلة للطلب.');
    }
    return Math.max(requested - received, 0);
  }

  function buildArrivalItems(lines, amountsByItemId) {
    if (!Array.isArray(lines) || !lines.length) throw new Error('لا توجد أصناف مرتبطة بهذا الطلب.');
    const amounts = amountsByItemId instanceof Map
      ? amountsByItemId
      : new Map(Object.entries(amountsByItemId || {}));
    const result = [];
    for (const line of lines) {
      const raw = amounts.get(String(line.request_item_id));
      const amount = raw == null || String(raw).trim() === '' ? 0 : Number(raw);
      const max = remainingQuantity(line.requested_quantity, line.received_quantity);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('أدخل كمية صحيحة لا تقل عن صفر.');
      if (amount > max) throw new Error(`الكمية تتجاوز المتبقي للصنف: ${line.product_name || '—'}.`);
      if (amount > 0) {
        result.push({ request_item_id: String(line.request_item_id), received_quantity: amount });
      }
    }
    if (!result.length) throw new Error('أدخل كمية مستلمة واحدة على الأقل.');
    return result;
  }

  function receiptPhotoPath(branchId, requestId, idempotencyKey, file) {
    const ids = [branchId, requestId, idempotencyKey];
    if (ids.some(value => !UUID_PATTERN.test(String(value || '')))) throw new Error('معرّفات الاستلام غير صالحة.');
    const extension = validateReceiptPhoto(file);
    return `${branchId}/${requestId}/${idempotencyKey}.${extension}`;
  }

  function deadlineState(receivedAt, now = Date.now()) {
    const receivedMs = typeof receivedAt === 'number' ? receivedAt : Date.parse(receivedAt);
    const nowMs = typeof now === 'number' ? now : Date.parse(now);
    if (!Number.isFinite(receivedMs) || !Number.isFinite(nowMs)) throw new Error('تاريخ الاستلام غير صالح.');
    const deadlineMs = receivedMs + STORAGE_WINDOW_MS;
    return {
      receivedAt: new Date(receivedMs).toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
      overdue: nowMs > deadlineMs,
      remainingMs: Math.max(deadlineMs - nowMs, 0),
    };
  }

  function reuseOrCreateIdempotencyDraft(previous, fingerprint, createUuid) {
    if (previous && previous.fingerprint === fingerprint && UUID_PATTERN.test(String(previous.key || ''))) return previous;
    if (typeof createUuid !== 'function') throw new Error('لا يمكن إنشاء مفتاح استلام جديد.');
    const key = createUuid();
    if (!UUID_PATTERN.test(String(key || ''))) throw new Error('مفتاح الاستلام غير صالح.');
    return { key, fingerprint };
  }

  function validateCompletionInput(input = {}) {
    if (input.itemVerified !== true || input.quantityVerified !== true || input.expiryChecked !== true) {
      throw new Error('يجب تأكيد مطابقة الصنف والكمية وفحص الصلاحية.');
    }
    if (!['intact', 'damaged', 'compromised'].includes(input.packageCondition)) throw new Error('اختر حالة العبوة.');
    const packageNotes = String(input.packageNotes || '').trim();
    if (input.packageCondition !== 'intact' && !packageNotes) throw new Error('أضف ملاحظة لحالة العبوة.');
    if (packageNotes.length > 2000) throw new Error('ملاحظة العبوة طويلة جداً.');
    if (!['FIFO', 'FEFO'].includes(input.storageMethod)) throw new Error('اختر FIFO أو FEFO.');
    const expiryDate = input.expiryDate ? String(input.expiryDate) : null;
    if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw new Error('تاريخ انتهاء الصلاحية غير صالح.');
    return { ...input, packageNotes: packageNotes || null, expiryDate };
  }

  function canDisplaySupervisorReceivingTasks(role, status, branchOperational) {
    return role === 'Supervisor' && status === 'active' && branchOperational === true;
  }

  return {
    MAX_RECEIPT_PHOTO_BYTES,
    STORAGE_WINDOW_MS,
    PHOTO_EXTENSIONS,
    validateReceiptPhoto,
    receiptPhotoDigest,
    isReceiptPhotoAlreadyUploaded,
    remainingQuantity,
    buildArrivalItems,
    receiptPhotoPath,
    deadlineState,
    reuseOrCreateIdempotencyDraft,
    validateCompletionInput,
    canDisplaySupervisorReceivingTasks,
  };
});
