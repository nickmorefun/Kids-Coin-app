import { NextRequest, NextResponse } from 'next/server';
import { verifyWldPayment } from '@/lib/verify-payment';

/**
 * Backend payment confirmation endpoint for World App MiniKit payments.
 * Verifies transaction receipts with the Worldcoin Developer Portal API.
 *
 * This endpoint fails closed: if the payment cannot be verified — for any reason,
 * including a missing DEV_PORTAL_API_KEY — it reports failure rather than confirming.
 * Callers must treat anything other than `verified: true` as "not paid".
 *
 * @see https://docs.world.org/mini-apps/commands/pay
 */
export async function POST(req: NextRequest) {
  try {
    const { transaction_id, reference } = (await req.json()) as {
      transaction_id?: string;
      reference?: string;
    };

    if (!transaction_id) {
      return NextResponse.json(
        { error: 'transaction_id is required' },
        { status: 400 }
      );
    }

    const result = await verifyWldPayment({
      transactionId: transaction_id,
      reference,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          reason: result.reason,
          retryable: result.retryable,
          transaction_id,
          reference,
        },
        // 202 while the transaction is still settling, 402 once it definitively did not pay.
        { status: result.retryable ? 202 : 402 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
      status: result.status,
      transaction_hash: result.transactionHash,
      transaction_id,
      reference,
    });
  } catch (error) {
    console.error('Confirm payment error:', error);
    return NextResponse.json(
      { error: 'Internal server error confirming payment' },
      { status: 500 }
    );
  }
}
