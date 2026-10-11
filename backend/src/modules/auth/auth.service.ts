import { randomBytes } from "node:crypto";
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import { digestToken } from "../sessions/session-cookies";
import { UsersService } from "../users/users.service";
import { SessionsService } from "../sessions/sessions.service";
import {
  createSteamAuthenticationUrl,
  parseOpenIdCallback,
  type ParsedOpenIdCallback,
} from "./steam-openid";
import { SteamOpenIdVerifier } from "./steam-openid-verifier";

export type SteamAuthAttempt = {
  authUrl: URL;
  browserToken: string;
  maximumAgeSeconds: number;
};

export type CompletedSteamAuth = {
  returnTo: string;
  sessionToken: string;
  sessionMaximumAgeSeconds: number;
};

type StoredAttempt = {
  browserToken: string;
  expiresAt: number;
  returnTo: string;
  consumedAt: number | null;
};

const SAFE_RETURN_PATHS = new Set(["/", "/cart", "/checkout", "/balance/top-up", "/account", "/account/steam"]);

function sanitizeReturnTo(value: unknown): string {
  return typeof value === "string" && SAFE_RETURN_PATHS.has(value) ? value : "/account";
}

function redirectReturnToFrontend(returnTo: string): string {
  const frontendOrigin = process.env.PUBLIC_FRONTEND_ORIGIN?.trim();
  if (!frontendOrigin) return returnTo;
  const origin = new URL(frontendOrigin);
  if (
    (origin.protocol !== "https:" && origin.protocol !== "http:") ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    throw new Error("PUBLIC_FRONTEND_ORIGIN must be a valid HTTP(S) origin.");
  }
  return new URL(returnTo, origin).toString();
}

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, StoredAttempt>();
  private readonly attemptTtlSeconds = 300;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(SteamOpenIdVerifier) private readonly verifier: SteamOpenIdVerifier,
  ) {}

  async beginSteam(returnToInput: unknown): Promise<SteamAuthAttempt> {
    const state = randomBytes(32).toString("base64url");
    const browserToken = randomBytes(32).toString("base64url");
    const returnTo = sanitizeReturnTo(returnToInput);
    const baseUrl = new URL(process.env.PUBLIC_BASE_URL ?? "https://shards.local");
    const callbackUrl = new URL("auth/steam/callback", `${baseUrl.toString().replace(/\/$/, "")}/`);
    callbackUrl.searchParams.set("state", state);

    if (this.database.isConfigured()) {
      await this.database.query(
        `
          INSERT INTO steam_auth_attempts (
            state_digest,
            browser_token_digest,
            return_to,
            expires_at
          )
          VALUES ($1, $2, $3, clock_timestamp() + ($4 * interval '1 second'))
        `,
        [digestToken(state), digestToken(browserToken), returnTo, this.attemptTtlSeconds],
      );
    } else {
      this.attempts.set(state, {
        browserToken,
        expiresAt: Date.now() + this.attemptTtlSeconds * 1_000,
        returnTo,
        consumedAt: null,
      });
    }

    return {
      authUrl: createSteamAuthenticationUrl(callbackUrl, baseUrl),
      browserToken,
      maximumAgeSeconds: this.attemptTtlSeconds,
    };
  }

  async completeSteam(rawQuery: string, browserToken: string | null, presentedSessionToken: string | null): Promise<CompletedSteamAuth> {
    if (browserToken === null) throw new UnauthorizedException("Invalid Steam Authentication");
    const state = new URLSearchParams(rawQuery).get("state");
    if (state === null) throw new BadRequestException("Invalid Steam Authentication");
    const attempt = await this.findAttempt(state, browserToken);
    if (!attempt) {
      throw new UnauthorizedException("Invalid Steam Authentication");
    }

    const baseUrl = new URL(process.env.PUBLIC_BASE_URL ?? "https://shards.local");
    const expectedReturnTo = new URL("auth/steam/callback", `${baseUrl.toString().replace(/\/$/, "")}/`);
    expectedReturnTo.searchParams.set("state", state);
    const parsed = parseOpenIdCallback({
      expectedReturnTo,
      futureSkewSeconds: 60,
      maximumNonceAgeSeconds: 300,
      now: process.env.STEAM_OPENID_TEST_NOW ? new Date(process.env.STEAM_OPENID_TEST_NOW) : new Date(),
      rawQuery,
    });
    await this.verifySteam(parsed);

    await this.recordAssertion(parsed);
    await this.consumeAttempt(state, attempt);
    const user = await this.users.upsertSteamUser(parsed.identity);
    const session = await this.sessions.createSession(user.id, presentedSessionToken);

    return {
      returnTo: redirectReturnToFrontend(attempt.returnTo),
      sessionToken: session.token,
      sessionMaximumAgeSeconds: session.maximumAgeSeconds,
    };
  }

  private async verifySteam(parsed: ParsedOpenIdCallback): Promise<void> {
    if (!(await this.verifier.verify(parsed.openIdFields))) {
      throw new UnauthorizedException("Invalid Steam Authentication");
    }
  }

  private async findAttempt(state: string, browserToken: string): Promise<StoredAttempt | null> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{ return_to: string; expires_at: Date; consumed_at: Date | null }>(
        `
          SELECT return_to, expires_at, consumed_at
          FROM steam_auth_attempts
          WHERE state_digest = $1
            AND browser_token_digest = $2
          LIMIT 1
        `,
        [digestToken(state), digestToken(browserToken)],
      );
      const row = result.rows[0];
      if (!row || row.consumed_at !== null || row.expires_at.getTime() <= Date.now()) return null;
      return {
        browserToken,
        expiresAt: row.expires_at.getTime(),
        returnTo: row.return_to,
        consumedAt: null,
      };
    }

    const attempt = this.attempts.get(state);
    if (!attempt || attempt.consumedAt !== null || attempt.expiresAt <= Date.now() || attempt.browserToken !== browserToken) return null;
    return attempt;
  }

  private async consumeAttempt(state: string, attempt: StoredAttempt): Promise<void> {
    if (this.database.isConfigured()) {
      await this.database.query(
        `
          UPDATE steam_auth_attempts
          SET consumed_at = clock_timestamp()
          WHERE state_digest = $1
            AND consumed_at IS NULL
        `,
        [digestToken(state)],
      );
      return;
    }

    this.attempts.set(state, { ...attempt, consumedAt: Date.now() });
  }

  private async recordAssertion(parsed: ParsedOpenIdCallback): Promise<void> {
    if (!this.database.isConfigured()) return;
    const result = await this.database.query<{ response_nonce: string }>(
      `
        INSERT INTO steam_openid_assertions (
          response_nonce,
          steam_id64,
          claimed_identifier
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (response_nonce) DO NOTHING
        RETURNING response_nonce
      `,
      [parsed.identity.responseNonce, parsed.identity.steamId64, parsed.identity.claimedIdentifier],
    );
    if (result.rows.length === 0) throw new UnauthorizedException("Invalid Steam Authentication");
  }
}
