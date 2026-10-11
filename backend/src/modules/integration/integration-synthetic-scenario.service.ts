import { Inject, Injectable } from "@nestjs/common";

import { PaymentsService } from "../payments/payments.service";

const SYNTHETIC_USER_ID = "synthetic:vv-admin";
const SYNTHETIC_TOP_UP_COIN_MINOR = 10_000;

export type IntegrationSyntheticScenarioResult = {
  readonly status: "healthy" | "down";
  readonly summary: string;
  readonly error: string | null;
  readonly payment: { readonly reached: boolean };
  readonly syntheticEntities: readonly {
    readonly type: string;
    readonly externalId: string;
    readonly cleanupStatus: "retained" | "failed" | "cancelled" | "expired";
  }[];
  readonly steps: readonly Record<string, unknown>[];
  readonly artifacts: readonly Record<string, unknown>[] | null;
  readonly metadata: Record<string, unknown> | null;
};

@Injectable()
export class IntegrationSyntheticScenarioService {
  constructor(
    @Inject(PaymentsService) private readonly payments: Pick<PaymentsService, "createTopUpSession" | "expireSyntheticTopUpSession">,
  ) {}

  async runCheckoutPaymentReached(input: {
    readonly runId: string;
  }): Promise<IntegrationSyntheticScenarioResult> {
    const startedAt = new Date().toISOString();
    const topUp = await this.payments.createTopUpSession({
      userId: SYNTHETIC_USER_ID,
      idempotencyKey: `vv-admin-synthetic-${input.runId}`,
      coinAmountMinor: SYNTHETIC_TOP_UP_COIN_MINOR,
    });
    const reached = topUp.status === "checkout_pending" && topUp.checkoutUrl !== null;
    let cleanupStatus: "retained" | "failed" | "expired" = "retained";
    let cleanupError: string | null = null;
    if (reached) {
      try {
        await this.payments.expireSyntheticTopUpSession({
          topUpPaymentId: topUp.id,
          userId: SYNTHETIC_USER_ID,
        });
        cleanupStatus = "expired";
      } catch (error) {
        cleanupStatus = "failed";
        cleanupError = error instanceof Error ? error.message : "TOP_UP_SYNTHETIC_CLEANUP_FAILED";
      }
    }
    const healthy = reached && cleanupStatus === "expired";
    return {
      status: healthy ? "healthy" : "down",
      summary: healthy
        ? "Платежная страница Arc Pay получена"
        : reached
          ? "Платежная страница Arc Pay получена, но synthetic top-up не очищен"
          : "Платежная страница Arc Pay не получена",
      error: healthy ? null : (cleanupError ?? "TOP_UP_PAYMENT_REDIRECT_MISSING"),
      payment: { reached },
      syntheticEntities: [
        {
          type: "top_up_payment",
          externalId: topUp.id,
          cleanupStatus,
        },
      ],
      steps: [
        {
          key: "top_up_session",
          status: topUp.status,
          startedAt,
          finishedAt: new Date().toISOString(),
        },
      ],
      artifacts: reached && topUp.checkoutUrl
        ? [{ kind: "payment_redirect_origin", value: new URL(topUp.checkoutUrl).origin }]
        : null,
      metadata: {
        topUpPaymentId: topUp.id,
        coinAmountMinor: topUp.coinAmountMinor,
      },
    };
  }
}
