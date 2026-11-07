import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { PaymentsService, type TopUpSessionDto } from "../payments/payments.service";
import { SYNTHETIC_PAYMENT_USER_ID } from "../payments/synthetic-payment";

export type IntegrationSyntheticScenarioResult = {
  readonly status: "down";
  readonly summary: string;
  readonly error: string;
  readonly payment: { readonly reached: false };
  readonly syntheticEntities: readonly { readonly type: "top_up"; readonly externalId: string; readonly cleanupStatus: "retained" }[];
  readonly steps: readonly Record<string, unknown>[];
  readonly artifacts: null;
  readonly metadata: Record<string, unknown> | null;
  readonly browserPayment?: { readonly method: "POST"; readonly topUpId: string; readonly action: string; readonly successUrl: string; readonly failUrl: string };
};

@Injectable()
export class IntegrationSyntheticScenarioService {
  constructor(
    @Inject(PaymentsService) private readonly payments: Pick<PaymentsService, "createTopUpSession">,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async runCheckoutPaymentReached(input: { readonly runId: string }): Promise<IntegrationSyntheticScenarioResult> {
    const startedAt = new Date().toISOString();
    let topUp: TopUpSessionDto | undefined;
    const result = (error: string): IntegrationSyntheticScenarioResult => ({
      status: "down", summary: error === "BROWSER_PAYMENT_REQUIRED" ? "Ожидается проверка платежной страницы" : "Путь до оплаты не подтвержден",
      error, payment: { reached: false },
      syntheticEntities: topUp ? [{type:"top_up",externalId:topUp.id,cleanupStatus:"retained"}] : [],
      steps: [{key:"top_up_session",startedAt,finishedAt:new Date().toISOString(),status:topUp?.status ?? "failed"}],
      artifacts: null, metadata: topUp ? {topUpPaymentId:topUp.id,coinAmountMinor:topUp.coinAmountMinor} : null,
    });
    if (!this.config.commerce?.paymentsEnabled || this.config.arcoPay.providerMode !== "real") return result("SCENARIO_PAYMENTS_DISABLED");
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.runId)) return result("SCENARIO_RUN_ID_INVALID");
    try {
      topUp = await this.payments.createTopUpSession({userId:SYNTHETIC_PAYMENT_USER_ID,idempotencyKey:`vv-admin-synthetic-${input.runId}`,coinAmountMinor:10_000});
    } catch (error) {
      return result(error instanceof Error && error.message === "SCENARIO_ATTEMPT_REQUIRES_REVIEW" ? error.message : "SCENARIO_PAYMENT_CREATE_FAILED");
    }
    if (topUp.status !== "checkout_pending" || !topUp.checkoutUrl) return result("SCENARIO_PAYMENT_NOT_PENDING");
    try {
      const action = new URL(topUp.checkoutUrl);
      if (action.origin !== "https://payment.paidlayer.com" || action.origin !== this.config.arcoPay.paymentOrigin || action.username || action.password || action.search || action.hash || !/^\/[a-zA-Z0-9_-]{1,128}$/.test(action.pathname)) throw new Error();
      const origin = new URL(this.config.integration.publicOrigin);
      if(origin.protocol !== "https:" || origin.username || origin.password) throw new Error();
      const success = new URL("/payments/return",origin.origin);
      success.searchParams.set("session",topUp.id);
      const fail = new URL(success);
      success.searchParams.set("payment","success"); fail.searchParams.set("payment","failed");
      // Transient only. VV Admin loads this native hosted form and persists sanitized evidence.
      // The invoice remains pending; local expiry cannot prove provider cancellation.
      return {...result("BROWSER_PAYMENT_REQUIRED"),browserPayment:{method:"POST",topUpId:topUp.id,action:action.href,successUrl:success.href,failUrl:fail.href}};
    } catch { return result("SCENARIO_PAYMENT_HANDOFF_INVALID"); }
  }
}
