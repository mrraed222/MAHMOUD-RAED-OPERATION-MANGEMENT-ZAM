import assert from 'node:assert/strict';
import { EmailProviderError, sendEmailWithResend } from '../supabase/functions/send-report-copy/email-provider.mjs';

const testPayload = {
  from: 'ZAM Operations <operations@zam.sa>',
  to: ['manager@example.test', 'supervisor@example.test'],
  subject: 'تقرير وردية تجريبي',
  html: '<p dir="rtl">نص محاكاة فقط</p>',
  attachments: [{ filename: 'report.pdf', content: 'JVBERi0=' }],
};
const idempotencyKey = 'zam-daily-report-copy:30000000-0000-4000-8000-000000000001';

async function testAcceptedReceipt() {
  let seenUrl = '';
  let seenOptions;
  const receipt = await sendEmailWithResend({
    apiKey: 'test-key-not-a-secret', payload: testPayload, idempotencyKey,
    fetcher: async (url, options) => {
      seenUrl = url;
      seenOptions = options;
      return { ok: true, status: 200, json: async () => ({ id: 'resend-test-id' }) };
    },
  });
  assert.equal(seenUrl, 'https://api.resend.com/emails');
  assert.equal(seenOptions.method, 'POST');
  assert.equal(seenOptions.headers.Authorization, 'Bearer test-key-not-a-secret');
  assert.equal(seenOptions.headers['Idempotency-Key'], idempotencyKey);
  assert.equal(JSON.parse(seenOptions.body).from, 'ZAM Operations <operations@zam.sa>');
  assert.equal(receipt.id, 'resend-test-id');
}

async function testProviderRejection() {
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload, idempotencyKey,
      fetcher: async () => ({ ok: false, status: 503, json: async () => ({ message: 'sensitive provider detail' }) }),
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_rejected'
      && error.status === 503 && error.outcome === 'unknown',
  );
}

async function testMissingReceiptIsUnknown() {
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload, idempotencyKey,
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_receipt_missing' && error.outcome === 'unknown',
  );
}

async function testMissingKeyDoesNotCallProvider() {
  let called = false;
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: '', payload: testPayload, idempotencyKey,
      fetcher: async () => { called = true; return { ok: true, status: 200, json: async () => ({ id: 'unexpected' }) }; },
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_not_configured',
  );
  assert.equal(called, false);
}

async function testMissingIdempotencyKeyDoesNotCallProvider() {
  let called = false;
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload,
      fetcher: async () => { called = true; return { ok: true, status: 200, json: async () => ({ id: 'unexpected' }) }; },
    }),
    error => error instanceof EmailProviderError && error.code === 'idempotency_key_invalid',
  );
  assert.equal(called, false);
}

async function testLostResponseIsUncertain() {
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload, idempotencyKey,
      fetcher: async () => { throw new TypeError('connection closed after provider accepted'); },
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_response_unknown' && error.outcome === 'unknown',
  );
}

async function testTimeoutIsUnknown() {
  let seenSignal;
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload, idempotencyKey, timeoutMs: 10,
      fetcher: async (_url, options) => {
        seenSignal = options.signal;
        return new Promise((_resolve, reject) => {
          seenSignal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
        });
      },
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_timeout' && error.outcome === 'unknown',
  );
  assert.ok(seenSignal?.aborted, 'the bounded timeout aborts the provider request');
}

async function testLateReceiptAfterBodyTimeoutIsUnknown() {
  let seenSignal;
  await assert.rejects(
    () => sendEmailWithResend({
      apiKey: 'test-key', payload: testPayload, idempotencyKey, timeoutMs: 10,
      fetcher: async (_url, options) => {
        seenSignal = options.signal;
        return {
          ok: true,
          status: 200,
          json: async () => new Promise(resolve => {
            seenSignal.addEventListener('abort', () => resolve({ id: 'late-provider-receipt' }), { once: true });
          }),
        };
      },
    }),
    error => error instanceof EmailProviderError && error.code === 'provider_timeout' && error.outcome === 'unknown',
  );
  assert.ok(seenSignal?.aborted, 'a late receipt after timeout cannot become a success');
}

await testAcceptedReceipt();
await testProviderRejection();
await testMissingReceiptIsUnknown();
await testLateReceiptAfterBodyTimeoutIsUnknown();
await testMissingKeyDoesNotCallProvider();
await testMissingIdempotencyKeyDoesNotCallProvider();
await testLostResponseIsUncertain();
await testTimeoutIsUnknown();
console.log('send-report-copy provider tests: 8 cases passed (all fetches mocked; no live email sent)');
