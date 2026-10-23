import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import type { PaymentHistoryDto, PaymentHistoryItemDto } from "./payment-history.dto";
import { paymentAvailability } from './payment-availability';

@Injectable()
export class PaymentHistoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listForUser(userId: string): Promise<PaymentHistoryDto> {
    const result = await this.database.query<Omit<PaymentHistoryItemDto, "createdAt" | "expiresAt" | "failureReason" | "canPay"> & { createdAt: Date; expiresAt: Date | null; providerStatus: string | null; checkoutUrl: string | null }>(`
      SELECT p.id, 'steam_refill' AS kind, p.status,
        p.fiat_amount_minor AS "amountMinor", p.fiat_currency AS currency,
        p.order_id AS "orderId", o.status AS "fulfillmentStatus", p.created_at AS "createdAt",
        p.expires_at AS "expiresAt", p.provider_status AS "providerStatus", p.provider_checkout_url AS "checkoutUrl"
      FROM steam_refill_payments p
      LEFT JOIN orders o ON o.id = p.order_id AND o.user_id = p.user_id
      WHERE p.user_id = $1 OR EXISTS(SELECT 1 FROM steam_refill_claims c WHERE c.payment_id=p.id AND c.user_id=$1)
      UNION ALL
      SELECT id, 'coins_top_up' AS kind, status,
        fiat_amount_minor AS "amountMinor", fiat_currency AS currency,
        NULL AS "orderId", NULL AS "fulfillmentStatus", created_at AS "createdAt",
        expires_at AS "expiresAt", provider_status AS "providerStatus", provider_checkout_url AS "checkoutUrl"
      FROM top_up_payments
      WHERE user_id = $1
      ORDER BY "createdAt" DESC, id DESC
    `, [userId]);
    return { payments: result.rows.map(({providerStatus,checkoutUrl,expiresAt,...row}) => ({ ...row, createdAt: row.createdAt.toISOString(), ...paymentAvailability(row.status,providerStatus,expiresAt,checkoutUrl) })) };
  }
}
