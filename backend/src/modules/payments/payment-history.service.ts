import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import type { PaymentHistoryDto, PaymentHistoryItemDto } from "./payment-history.dto";

@Injectable()
export class PaymentHistoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listForUser(userId: string): Promise<PaymentHistoryDto> {
    const result = await this.database.query<Omit<PaymentHistoryItemDto, "createdAt"> & { createdAt: Date }>(`
      SELECT p.id, 'steam_refill' AS kind, p.status,
        p.fiat_amount_minor AS "amountMinor", p.fiat_currency AS currency,
        p.order_id AS "orderId", o.status AS "fulfillmentStatus", p.created_at AS "createdAt"
      FROM steam_refill_payments p
      LEFT JOIN orders o ON o.id = p.order_id AND o.user_id = p.user_id
      WHERE p.user_id = $1
      UNION ALL
      SELECT id, 'coins_top_up' AS kind, status,
        fiat_amount_minor AS "amountMinor", fiat_currency AS currency,
        NULL AS "orderId", NULL AS "fulfillmentStatus", created_at AS "createdAt"
      FROM top_up_payments
      WHERE user_id = $1
      ORDER BY "createdAt" DESC, id DESC
    `, [userId]);
    return { payments: result.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }
}
