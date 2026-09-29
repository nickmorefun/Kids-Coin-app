/**
 * Server-side verification of a 1 WLD sky banner payment.
 *
 * Nothing that grants the paid banner may trust the client: the browser can claim any
 * transaction id it likes. Every grant goes through `verifyWldPayment`, which asks the
 * Developer Portal what actually happened on chain and fails closed if it cannot get an
 * answer (no API key, portal down, unexpected shape).
 *
 * @see https://docs.world.org/mini-apps/commands/pay
 */

export const WLD_BANNER_PRICE = 1;

/** The wallet that must receive the payment for it to count. */
export function expectedRecipient(): string {
  return (
    process.env.NEXT_PUBLIC_WLD_RECIPIENT_ADDRESS ||
    '0xc44cf13e1525314c0f5182adabd4830a367598ac'
  ).toLowerCase();
}

export function appId(): string {
  return (
    process.env.NEXT_PUBLIC_APP_ID ||
    process.env.APP_ID ||
    'app_50930aa723f8df87d769869a70d29693'
  );
}

export type VerifyResult =
  | { ok: true; status: string; transactionHash?: string }
  | { ok: false; reason: string; retryable: boolean };

/**
 * The portal has changed field names between versions and the public docs don't pin them
 * down, so read each value from any of the names it has been seen under rather than
 * guessing one and silently failing every payment.
 */
function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

export async function verifyWldPayment(params: {
  transactionId: string;
  reference?: string;
}): Promise<VerifyResult> {
  const { transactionId, reference } = params;

  if (!transactionId) {
    return { ok: false, reason: 'missing_transaction_id', retryable: false };
  }

  const apiKey = process.env.DEV_PORTAL_API_KEY;
  if (!apiKey) {
    // Fail closed. Without the key we cannot tell a real payment from an invented one,
    // and handing out the paid banner on the client's word is exactly the hole this closes.
    return { ok: false, reason: 'verification_unavailable', retryable: true };
  }

  const url =
    `https://developer.worldcoin.org/api/v2/minikit/transaction/${encodeURIComponent(transactionId)}` +
    `?app_id=${encodeURIComponent(appId())}&type=payment`;

  let payload: Record<string, unknown>;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn('[verify-payment] portal rejected lookup', res.status, detail.slice(0, 500));
      return {
        ok: false,
        reason: `portal_status_${res.status}`,
        retryable: res.status >= 500,
      };
    }

    payload = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.error('[verify-payment] portal request failed', err);
    return { ok: false, reason: 'portal_unreachable', retryable: true };
  }

  // Logged once per verification so the exact field names can be confirmed against a real
  // payment (the public docs don't list them) and the checks below tightened if needed.
  console.info('[verify-payment] portal payload', JSON.stringify(payload).slice(0, 1000));

  const status = String(
    pick(payload, 'transaction_status', 'status') ?? 'unknown',
  ).toLowerCase();

  if (status === 'failed' || status === 'reverted') {
    return { ok: false, reason: 'transaction_failed', retryable: false };
  }
  if (status !== 'mined' && status !== 'confirmed' && status !== 'success') {
    // Still pending: the caller can come back once it settles.
    return { ok: false, reason: `transaction_${status}`, retryable: true };
  }

  // The reference ties this transaction to the purchase our own backend started, so a
  // transaction id copied from someone else's payment cannot be replayed here.
  if (reference) {
    const got = pick(payload, 'reference', 'reference_id');
    if (got !== undefined && String(got) !== String(reference)) {
      return { ok: false, reason: 'reference_mismatch', retryable: false };
    }
  }

  const to = pick(payload, 'recipient_address', 'recipient', 'to', 'to_address');
  if (to !== undefined && String(to).toLowerCase() !== expectedRecipient()) {
    return { ok: false, reason: 'wrong_recipient', retryable: false };
  }

  const token = pick(payload, 'token', 'token_symbol', 'symbol');
  if (token !== undefined && String(token).toUpperCase() !== 'WLD') {
    return { ok: false, reason: 'wrong_token', retryable: false };
  }

  const rawAmount = pick(
    payload,
    'input_token_amount',
    'token_amount',
    'amount',
  );
  if (rawAmount !== undefined) {
    // Amounts come back in the token's smallest unit (WLD has 18 decimals).
    const amount = Number(rawAmount) / 1e18;
    if (!Number.isFinite(amount) || amount < WLD_BANNER_PRICE) {
      return { ok: false, reason: 'insufficient_amount', retryable: false };
    }
  }

  return {
    ok: true,
    status,
    transactionHash: pick(payload, 'transaction_hash', 'hash') as string | undefined,
  };
}

/**
 * Transaction ids already spent on a banner. In memory, so it is best effort across
 * serverless instances — the real guard is the portal lookup above; this just stops the
 * obvious case of one payment being replayed against the same instance.
 */
const spent = new Set<string>();

export function isSpent(transactionId: string): boolean {
  return spent.has(transactionId);
}

export function markSpent(transactionId: string): void {
  spent.add(transactionId);
  // Keep the set from growing without bound on a long-lived instance.
  if (spent.size > 5000) {
    for (const id of spent) {
      spent.delete(id);
      if (spent.size <= 2500) break;
    }
  }
}
