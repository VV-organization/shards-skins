import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { IntegrationController } from "./integration.controller";

describe("IntegrationController synthetic scenario endpoint", () => {
  it("runs checkout-payment-reached when the signed request is valid", async () => {
    const scenario = {
      runCheckoutPaymentReached: vi.fn().mockResolvedValue({ status: "healthy" }),
    };
    const verifier = { verify: vi.fn().mockReturnValue(true) };
    const controller = createController({ scenario, verifier });

    await expect(
      controller.runCheckoutPaymentReached(
        { runId: "run-1" },
      {
        "x-vv-admin-signature": "test-signature",
        "x-vv-admin-timestamp": "2026-08-13T12:00:00.000Z",
      },
      ),
    ).resolves.toEqual({ status: "healthy" });
    expect(scenario.runCheckoutPaymentReached).toHaveBeenCalledWith({
      runId: "run-1",
    });
  });

  it("rejects missing run id", async () => {
    const controller = createController({ scenario: {
      runCheckoutPaymentReached: vi.fn(),
    }, verifier: { verify: vi.fn().mockReturnValue(true) } });

    await expect(
      controller.runCheckoutPaymentReached({}, {
        "x-vv-admin-signature": "test-signature",
        "x-vv-admin-timestamp": "2026-08-13T12:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unsigned requests", async () => {
    const controller = createController({ scenario: {
      runCheckoutPaymentReached: vi.fn(),
    }, verifier: { verify: vi.fn().mockReturnValue(false) } });

    await expect(
      controller.runCheckoutPaymentReached({ runId: "run-1" }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it("reports PostgreSQL dependency failure as HTTP 503", async()=>{
    const result={status:"down" as const,reasons:["POSTGRES_UNAVAILABLE"]};
    const controller=new IntegrationController({} as never,{} as never,{} as never,{postgres:()=>Promise.resolve(result)} as never);
    const response={status:vi.fn()};
    expect(await controller.postgresHealth(response as never)).toEqual(result);
    expect(response.status).toHaveBeenCalledWith(503);
  });

});

function createController(input: { scenario: unknown; verifier: unknown }): IntegrationController {
  return new IntegrationController(
    {} as never,
    input.scenario as never,
    input.verifier as never,
    {} as never,
  );
}
