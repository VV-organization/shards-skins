import { describe, expect, it } from "vitest";

import type { DatabaseService } from "../../common/database/database.service";
import { UsersService } from "./users.service";

describe("UsersService", () => {
  it("creates an email-only customer without pretending it has Steam", async () => {
    const disabledDatabase = {
      isConfigured: () => false,
    } as unknown as DatabaseService;
    const users = new UsersService(disabledDatabase);

    const user = await users.upsertEmailUser(" Buyer@Example.com ");

    expect(user).toMatchObject({
      email: { address: "buyer@example.com", verified: true },
      steam: { connected: false },
    });
    expect(user.id).toMatch(/^user_email_/);
  });

  it("keeps Steam Trade URL credentials out of public user records", async () => {
    const disabledDatabase = {
      isConfigured: () => false,
    } as unknown as DatabaseService;
    const users = new UsersService(disabledDatabase);

    const user = await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000001",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-07-27T10:00:00Znonce",
      steamId64: "76561198000000001",
    });

    await users.saveSteamTradeCredential(user.id, { partner: "39734273", token: "secretToken" });

    expect(JSON.stringify(await users.requireUser(user.id))).not.toContain("secretToken");
    expect(await users.requireSteamTradeCredential(user.id)).toEqual({
      partner: "39734273",
      token: "secretToken",
    });
  });
});
