import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { QueryResult, QueryResultRow } from 'pg';
import type { AppConfig } from '../../config/app-config';

export const SYNTHETIC_PAYMENT_USER_ID = 'synthetic:vv-admin';

export function paymentEventSource(userId: string): 'scenario' | 'customer' {
  return userId === SYNTHETIC_PAYMENT_USER_ID ? 'scenario' : 'customer';
}

/** Called under the existing payment:user advisory lock, after idempotent replay. */
export async function assertSyntheticPaymentCreationAllowed(
  client: { query: <Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]) => Promise<QueryResult<Row>> },
  config: AppConfig,
  userId: string,
): Promise<void> {
  if (userId !== SYNTHETIC_PAYMENT_USER_ID) return;
  if (!config.commerce?.paymentsEnabled || config.arcoPay.providerMode !== 'real') {
    throw new ServiceUnavailableException('SCENARIO_PAYMENTS_DISABLED');
  }
  const pending = await client.query(
    `SELECT id FROM top_up_payments WHERE user_id=$1
      AND status IN ('provider_creation_pending','checkout_pending','manual_review') LIMIT 1`,
    [SYNTHETIC_PAYMENT_USER_ID],
  );
  if (pending.rows.length) throw new ConflictException('SCENARIO_ATTEMPT_REQUIRES_REVIEW');
}
