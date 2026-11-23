import assert from 'node:assert/strict';
import { sendEmailWithResend } from '../supabase/functions/send-report-copy/email-provider.mjs';
import { sendReportEmailOnce } from '../supabase/functions/send-report-copy/email-send-once.mjs';

const payload = {
  from: 'ZAM Operations <operations@zam.sa>',
  to: ['supervisor@example.test'],
  subject: 'اختبار idempotency',
  html: '<p>نص اختباري فقط</p>',
  attachments: [{ filename: 'report.pdf', content: 'JVBERi0=' }],
};
const stableKey = 'zam-daily-report-copy:30000000-0000-4000-8000-000000000001';
let ledgerState = null;
let providerAccepted = 0;
let providerRequests = 0;
let lastProviderMessageId = null;
const providerReceiptsByKey = new Map();
const seenKeys = [];

async function claimSend() {
  if (ledgerState === null) {
    ledgerState = 'sending';
    return { decision: 'send', idempotency_key: stableKey };
  }
  if (ledgerState === 'sent') {
    return { decision: 'already_sent', idempotency_key: stableKey, provider_message_id: lastProviderMessageId };
  }
  if (ledgerState === 'unknown') {
    ledgerState = 'sending';
    return { decision: 'send', idempotency_key: stableKey };
  }
  return { decision: 'in_progress', idempotency_key: stableKey };
}

async function finishSend({ state, providerMessageId }) {
  ledgerState = state;
  lastProviderMessageId = providerMessageId;
}

async function fakeResend(url, options) {
  assert.equal(url, 'https://api.resend.com/emails');
  const key = options.headers['Idempotency-Key'];
  seenKeys.push(key);
  providerRequests += 1;
  if (!providerReceiptsByKey.has(key)) {
    providerAccepted += 1;
    const receipt = { id: 'resend-existing-receipt' };
    providerReceiptsByKey.set(key, receipt);
    // Resend accepted the request, but the response never reaches the client before timeout.
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new TypeError('provider request timed out')), { once: true });
    });
  }
  return { ok: true, status: 200, json: async () => providerReceiptsByKey.get(key) };
}

async function sendOnce() {
  return sendReportEmailOnce({
    claimSend,
    finishSend,
    payload,
    sendEmail: ({ payload: outgoingPayload, idempotencyKey }) => sendEmailWithResend({
      apiKey: 'mock-only-key',
      payload: outgoingPayload,
      idempotencyKey,
      timeoutMs: 10,
      fetcher: fakeResend,
    }),
  });
}

const firstAttempt = await sendOnce();
assert.equal(firstAttempt.decision, 'unknown');
assert.equal(ledgerState, 'unknown');
assert.equal(providerAccepted, 1);

const retry = await sendOnce();
assert.equal(retry.decision, 'sent');
assert.equal(retry.providerMessageId, 'resend-existing-receipt');
assert.equal(ledgerState, 'sent');
assert.equal(providerRequests, 2, 'the retry reaches the provider with the same idempotency key');
assert.equal(providerAccepted, 1, 'the provider accepts only one logical email');
assert.deepEqual(seenKeys, [stableKey, stableKey]);

const duplicateAfterConfirmed = await sendOnce();
assert.equal(duplicateAfterConfirmed.decision, 'already_sent');
assert.equal(providerRequests, 2, 'a confirmed send never makes another provider request');
console.log('report email idempotency test: passed (accepted-but-response-lost; mock provider only)');
