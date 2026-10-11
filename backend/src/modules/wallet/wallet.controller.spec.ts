import { describe, expect, it, vi } from "vitest";

import { WalletController } from "./wallet.controller";
import type { WalletService } from "./wallet.service";

describe("WalletController", () => {
  it("returns the authenticated customer's balance projection in Coins minor units", async () => {
    const getBalance = vi.fn().mockResolvedValue({
      postedCoinMinor: 100_000,
      heldCoinMinor: 32_100,
      availableCoinMinor: 67_900,
    });
    const wallet = {
      getBalance,
    } as unknown as WalletService;
    const controller = new WalletController(wallet);

    await expect(controller.me({ userId: "user_76561198000000001", sessionId: "session_1" })).resolves.toEqual({
      postedCoinMinor: 100_000,
      heldCoinMinor: 32_100,
      availableCoinMinor: 67_900,
    });
    expect(getBalance).toHaveBeenCalledWith("user_76561198000000001");
  });
});
