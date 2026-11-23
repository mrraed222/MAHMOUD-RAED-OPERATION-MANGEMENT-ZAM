const PROVIDER_KEY_MAX_LENGTH = 256;

export async function sendReportEmailOnce({ claimSend, finishSend, sendEmail, payload }) {
  const claim = await claimSend();
  const decision = claim?.decision;
  if (decision !== 'send') {
    return {
      decision: decision || 'invalid_claim',
      idempotencyKey: claim?.idempotency_key || null,
      providerMessageId: claim?.provider_message_id || null,
    };
  }

  const idempotencyKey = claim.idempotency_key;
  if (typeof idempotencyKey !== 'string' || !idempotencyKey || idempotencyKey.length > PROVIDER_KEY_MAX_LENGTH) {
    return { decision: 'invalid_claim', idempotencyKey: null, providerMessageId: null };
  }

  try {
    const receipt = await sendEmail({ payload, idempotencyKey });
    if (!receipt || typeof receipt.id !== 'string' || !receipt.id) {
      throw Object.assign(new Error('provider_receipt_missing'), { outcome: 'unknown' });
    }
    await finishSend({ state: 'sent', providerMessageId: receipt.id });
    return { decision: 'sent', idempotencyKey, providerMessageId: receipt.id };
  } catch (error) {
    const state = error?.outcome === 'rejected' ? 'rejected' : 'unknown';
    try {
      await finishSend({ state, providerMessageId: null });
    } catch {
      // The DB claim remains recoverable; retries still use the same durable key.
    }
    return { decision: state, idempotencyKey, providerMessageId: null, error };
  }
}
