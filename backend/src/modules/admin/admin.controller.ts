import { Body, Controller, Get, Headers, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { IDEMPOTENCY_KEY_HEADER } from "../../common/http/http-headers";
import { AdminGuard } from "./admin.guard";
import { AdminService, type AdminFulfillmentReconciliationCommandBody, type AdminFulfillmentReconciliationResultDto, type AdminOperationsOverviewDto, type AdminPaymentReconciliationCommandBody, type AdminPaymentReconciliationResultDto } from "./admin.service";

const operationsOverviewSchema = {
  type: "object",
  required: ["generatedAt", "payments", "orders", "fulfillment", "webhooks"],
  properties: {
    generatedAt: { type: "string", format: "date-time" },
    payments: {
      type: "object",
      required: ["manualReview"],
      properties: {
        manualReview: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "userId", "status", "provider", "providerStatus", "coinAmountMinor", "fiatAmountMinor", "fiatCurrency", "manualReviewReason", "createdAt", "updatedAt"],
            properties: {
              id: { type: "string", format: "uuid" },
              userId: { type: "string" },
              status: { type: "string" },
              provider: { type: "string" },
              providerStatus: { type: "string", nullable: true },
              coinAmountMinor: { type: "integer" },
              fiatAmountMinor: { type: "integer" },
              fiatCurrency: { type: "string" },
              manualReviewReason: { type: "string", nullable: true },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    orders: {
      type: "object",
      required: ["problem"],
      properties: {
        problem: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "userId", "status", "totalCoinMinor", "lineCount", "openLineCount", "createdAt", "updatedAt"],
            properties: {
              id: { type: "string", format: "uuid" },
              userId: { type: "string" },
              status: { type: "string" },
              totalCoinMinor: { type: "integer" },
              lineCount: { type: "integer" },
              openLineCount: { type: "integer" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    fulfillment: {
      type: "object",
      required: ["commands"],
      properties: {
        commands: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "orderId", "orderLineId", "provider", "commandType", "status", "lastErrorCode", "lastAttemptOperation", "lastAttemptStatus", "createdAt", "updatedAt"],
            properties: {
              id: { type: "string", format: "uuid" },
              orderId: { type: "string", format: "uuid" },
              orderLineId: { type: "string", format: "uuid" },
              provider: { type: "string" },
              commandType: { type: "string" },
              status: { type: "string" },
              lastErrorCode: { type: "string", nullable: true },
              lastAttemptOperation: { type: "string", nullable: true },
              lastAttemptStatus: { type: "string", nullable: true },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    webhooks: {
      type: "object",
      required: ["problem"],
      properties: {
        problem: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "provider", "providerEventId", "status", "signatureStatus", "receivedAt", "processedAt"],
            properties: {
              id: { type: "string", format: "uuid" },
              provider: { type: "string" },
              providerEventId: { type: "string" },
              status: { type: "string" },
              signatureStatus: { type: "string" },
              receivedAt: { type: "string", format: "date-time" },
              processedAt: { type: "string", format: "date-time", nullable: true },
            },
          },
        },
      },
    },
  },
};

const reconciliationResultSchema = {
  type: "object",
  required: ["status", "idempotencyKey", "result"],
  properties: {
    status: { type: "string", enum: ["processed", "duplicate"] },
    idempotencyKey: { type: "string" },
    result: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          required: ["checked", "credited", "errors", "failed", "ignored", "manualReview", "steamRefillsCreated", "unmatched"],
          properties: {
            checked: { type: "integer" },
            credited: { type: "integer" },
            errors: { type: "integer" },
            failed: { type: "integer" },
            ignored: { type: "integer" },
            manualReview: { type: "integer" },
            steamRefillsCreated: { type: "integer" },
            unmatched: { type: "integer" },
          },
        },
      ],
    },
  },
};

const fulfillmentReconciliationResultSchema = {
  type: "object",
  required: ["status", "idempotencyKey", "result"],
  properties: {
    status: { type: "string", enum: ["processed", "duplicate"] },
    idempotencyKey: { type: "string" },
    result: {
      oneOf: [
        { type: "null" },
        {
          type: "object",
          required: ["checked", "commands", "errors", "reconciled"],
          properties: {
            checked: { type: "integer" },
            commands: {
              type: "array",
              items: {
                type: "object",
                required: ["commandId", "providerStatus"],
                properties: {
                  commandId: { type: "string", format: "uuid" },
                  providerStatus: { type: "string" },
                },
              },
            },
            errors: { type: "integer" },
            reconciled: { type: "integer" },
          },
        },
      ],
    },
  },
};

@ApiTags("Admin")
@UseGuards(AdminGuard)
@Controller("admin")
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @ApiOkResponse({ schema: operationsOverviewSchema })
  @ApiHeader({
    name: "X-Admin-Token",
    required: true,
    description: "Backend-only admin token loaded from ADMIN_API_TOKEN_FILE.",
  })
  @Get("operations/overview")
  overview(): Promise<AdminOperationsOverviewDto> {
    return this.admin.getOperationsOverview();
  }

  @ApiOkResponse({ schema: reconciliationResultSchema })
  @ApiHeader({
    name: "X-Admin-Token",
    required: true,
    description: "Backend-only admin token loaded from ADMIN_API_TOKEN_FILE.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: "Unique admin operation key. Reusing the same key with the same body returns duplicate without rerunning provider reconciliation.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: { type: "string", minLength: 10, maxLength: 500 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  })
  @HttpCode(200)
  @Post("operations/payments/reconcile")
  reconcilePayments(
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: AdminPaymentReconciliationCommandBody,
  ): Promise<AdminPaymentReconciliationResultDto> {
    return this.admin.reconcilePayments({
      body,
      idempotencyKey,
    });
  }

  @ApiOkResponse({ schema: fulfillmentReconciliationResultSchema })
  @ApiHeader({
    name: "X-Admin-Token",
    required: true,
    description: "Backend-only admin token loaded from ADMIN_API_TOKEN_FILE.",
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: "Unique admin operation key. Reusing the same key with the same body returns duplicate without rerunning SIH reconciliation.",
  })
  @ApiBody({
    required: true,
    schema: {
      type: "object",
      required: ["reason"],
      properties: {
        reason: { type: "string", minLength: 10, maxLength: 500 },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  })
  @HttpCode(200)
  @Post("operations/fulfillment/reconcile")
  reconcileFulfillment(
    @Headers(IDEMPOTENCY_KEY_HEADER) idempotencyKey: string | undefined,
    @Body() body: AdminFulfillmentReconciliationCommandBody,
  ): Promise<AdminFulfillmentReconciliationResultDto> {
    return this.admin.reconcileFulfillment({
      body,
      idempotencyKey,
    });
  }
}
