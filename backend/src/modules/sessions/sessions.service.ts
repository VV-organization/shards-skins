import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import {
  createCsrfToken,
  createOpaqueToken,
  digestToken,
  verifyCsrfToken,
} from "./session-cookies";

export type CurrentCustomer = {
  sessionId: string;
  userId: string;
};

export type CreatedSession = {
  token: string;
  maximumAgeSeconds: number;
};

type StoredSession = {
  id: string;
  userId: string;
  tokenDigest: string;
  expiresAt: number;
  revokedAt: number | null;
};

@Injectable()
export class SessionsService {
  private readonly sessionsByDigest = new Map<string, StoredSession>();
  private readonly csrfSecret = createHash("sha256")
    .update(process.env.COOKIE_HMAC_SECRET ?? "shards-development-cookie-secret", "utf8")
    .digest();
  private readonly maximumAgeSeconds = 60 * 60 * 24 * 30;

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async createSession(userId: string, presentedToken: string | null): Promise<CreatedSession> {
    if (presentedToken) await this.revoke(presentedToken);
    const token = createOpaqueToken();
    if (this.database.isConfigured()) {
      await this.database.query(
        `
          INSERT INTO user_sessions (
            user_id,
            token_digest,
            idle_expires_at,
            absolute_expires_at
          )
          VALUES ($1, $2, clock_timestamp() + ($3 * interval '1 second'), clock_timestamp() + ($3 * interval '1 second'))
        `,
        [userId, digestToken(token), this.maximumAgeSeconds],
      );
      return { token, maximumAgeSeconds: this.maximumAgeSeconds };
    }

    const session: StoredSession = {
      id: `session_${createOpaqueToken()}`,
      userId,
      tokenDigest: digestToken(token),
      expiresAt: Date.now() + this.maximumAgeSeconds * 1_000,
      revokedAt: null,
    };
    this.sessionsByDigest.set(session.tokenDigest, session);
    return { token, maximumAgeSeconds: this.maximumAgeSeconds };
  }

  async authenticate(token: string): Promise<CurrentCustomer | null> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{ session_id: string; user_id: string }>(
        `
          SELECT id AS session_id, user_id
          FROM user_sessions
          WHERE token_digest = $1
            AND revoked_at IS NULL
            AND idle_expires_at > clock_timestamp()
            AND absolute_expires_at > clock_timestamp()
          LIMIT 1
        `,
        [digestToken(token)],
      );
      const row = result.rows[0];
      if (!row) return null;
      await this.database.query(
        `
          UPDATE user_sessions
          SET last_seen_at = clock_timestamp()
          WHERE id = $1
            AND revoked_at IS NULL
        `,
        [row.session_id],
      );
      return { sessionId: row.session_id, userId: row.user_id };
    }

    const session = this.sessionsByDigest.get(digestToken(token));
    if (!session || session.revokedAt !== null || session.expiresAt <= Date.now()) return null;
    return { sessionId: session.id, userId: session.userId };
  }

  async revoke(token: string): Promise<void> {
    if (this.database.isConfigured()) {
      await this.database.query(
        `
          UPDATE user_sessions
          SET revoked_at = clock_timestamp()
          WHERE token_digest = $1
            AND revoked_at IS NULL
        `,
        [digestToken(token)],
      );
      return;
    }

    const session = this.sessionsByDigest.get(digestToken(token));
    if (session) this.sessionsByDigest.set(session.tokenDigest, { ...session, revokedAt: Date.now() });
  }

  createCsrfToken(sessionToken: string): string {
    return createCsrfToken(sessionToken, this.csrfSecret);
  }

  verifyCsrfToken(sessionToken: string, csrfToken: string): boolean {
    return verifyCsrfToken(sessionToken, csrfToken, this.csrfSecret);
  }
}
