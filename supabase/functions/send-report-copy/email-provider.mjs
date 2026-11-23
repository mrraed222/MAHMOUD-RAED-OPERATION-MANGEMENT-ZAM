export class EmailProviderError extends Error {
  constructor(code, status = null, outcome = 'unknown') {
    super(code);
    this.name = 'EmailProviderError';
    this.code = code;
    this.status = status;
    this.outcome = outcome;
  }
}

const RESEND_REQUEST_TIMEOUT_MS = 30_000;

export async function sendEmailWithResend({
  apiKey,
  payload,
  idempotencyKey,
  fetcher = globalThis.fetch,
  timeoutMs = RESEND_REQUEST_TIMEOUT_MS,
}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new EmailProviderError('provider_not_configured', null, 'rejected');
  }
  if (typeof fetcher !== 'function') {
    throw new EmailProviderError('provider_fetch_unavailable', null, 'rejected');
  }
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > 256) {
    throw new EmailProviderError('idempotency_key_invalid', null, 'rejected');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > RESEND_REQUEST_TIMEOUT_MS) {
    throw new EmailProviderError('provider_timeout_invalid', null, 'rejected');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let result = null;
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    try {
      result = await response.json();
    } catch {
      // A successful HTTP code without a parseable provider receipt is not proof of delivery.
    }
    if (controller.signal.aborted) {
      throw new EmailProviderError('provider_timeout', null, 'unknown');
    }
  } catch {
    if (controller.signal.aborted) {
      throw new EmailProviderError('provider_timeout', null, 'unknown');
    }
    throw new EmailProviderError('provider_response_unknown', null, 'unknown');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const outcome = response.status === 409 || response.status >= 500 ? 'unknown' : 'rejected';
    throw new EmailProviderError('provider_rejected', response.status, outcome);
  }
  if (!result || typeof result.id !== 'string' || !result.id.trim()) {
    throw new EmailProviderError('provider_receipt_missing', response.status, 'unknown');
  }
  return { id: result.id };
}
