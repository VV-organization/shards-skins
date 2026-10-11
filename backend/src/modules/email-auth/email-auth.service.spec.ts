import { describe, expect, it } from "vitest";

import type { DatabaseService } from "../../common/database/database.service";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";
import { EmailAuthService } from "./email-auth.service";

function createService() {
  const database = { isConfigured: () => false } as unknown as DatabaseService;
  const users = new UsersService(database);
  const sessions = new SessionsService(database);
  let now = new Date("2026-08-11T12:00:00.000Z");
  const service = new EmailAuthService(database, users, sessions, {
    createCode: () => "123456",
    now: () => now,
  }, undefined);
  return {
    advance: (milliseconds: number) => { now = new Date(now.getTime() + milliseconds); },
    service,
    sessions,
    users,
  };
}

describe("EmailAuthService", () => {
  it("consumes a correct unexpired OTP once and creates an email-only session", async () => {
    const { service } = createService();
    const challenge = await service.requestChallenge(" Buyer@Example.com ");

    const completed = await service.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: null,
    });

    expect(completed.email).toBe("buyer@example.com");
    expect(completed.sessionToken).toEqual(expect.any(String));
    await expect(service.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: null,
    })).rejects.toMatchObject({ status: 401 });
  });

  it("links a verified email to the presented Steam session user", async () => {
    const { service, sessions, users } = createService();
    const steamUser = await users.upsertSteamUser({
      claimedIdentifier: "https://steamcommunity.com/openid/id/76561198000000001",
      providerEndpoint: "https://steamcommunity.com/openid/login",
      responseNonce: "2026-08-14T15:00:00Znonce",
      steamId64: "76561198000000001",
    });
    const steamSession = await sessions.createSession(steamUser.id, null);
    const challenge = await service.requestChallenge(" Buyer@Example.com ", { purpose: "link_email", presentedSessionToken: steamSession.token });

    const completed = await service.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: steamSession.token,
    });

    expect(completed.userId).toBe(steamUser.id);
    await expect(sessions.authenticate(steamSession.token)).resolves.toBeNull();
    await expect(users.requireUser(steamUser.id)).resolves.toMatchObject({
      email: { address: "buyer@example.com", verified: true },
      steam: { connected: true, steamId64: "76561198000000001" },
    });
  });

  it("rejects an expired OTP without creating a customer session", async () => {
    const { advance, service } = createService();
    const challenge = await service.requestChallenge("buyer@example.com");
    advance(10 * 60 * 1000 + 1);

    await expect(service.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: null,
    })).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a sixth invalid OTP attempt", async () => {
    const { service } = createService();
    const challenge = await service.requestChallenge("buyer@example.com");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.verifyChallenge({
        challengeId: challenge.id,
        code: "000000",
        presentedSessionToken: null,
      })).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.verifyChallenge({
      challengeId: challenge.id,
      code: "123456",
      presentedSessionToken: null,
    })).rejects.toMatchObject({ status: 401 });
  });
  it("never switches the Steam owner when linking an email that belongs to another account", async () => {
    const { service, sessions, users } = createService();
    const emailUser = await users.upsertEmailUser("taken@example.com");
    const steamUser = await users.upsertSteamUser({ claimedIdentifier:"https://steamcommunity.com/openid/id/76561198000000001", providerEndpoint:"https://steamcommunity.com/openid/login", responseNonce:"fixture", steamId64:"76561198000000001" });
    const session = await sessions.createSession(steamUser.id,null);
    const challenge = await service.requestChallenge("taken@example.com", {purpose:"link_email",presentedSessionToken:session.token});
    await expect(service.verifyChallenge({challengeId:challenge.id,code:"123456",presentedSessionToken:session.token})).rejects.toMatchObject({status:409});
    expect((await sessions.authenticate(session.token))?.userId).toBe(steamUser.id);
    expect((await users.requireUser(emailUser.id)).email?.address).toBe("taken@example.com");
  });
  it("rejects link verification after logout or replacement of its session", async () => {
    const { service, sessions, users } = createService();
    const user = await users.upsertEmailUser("owner@example.com");
    const session = await sessions.createSession(user.id,null);
    const challenge = await service.requestChallenge("new@example.com", {purpose:"link_email",presentedSessionToken:session.token});
    const replacement = await sessions.createSession(user.id,session.token);
    await expect(service.verifyChallenge({challengeId:challenge.id,code:"123456",presentedSessionToken:replacement.token})).rejects.toMatchObject({status:401});
    expect((await users.requireUser(user.id)).email?.address).toBe("owner@example.com");
  });

});
