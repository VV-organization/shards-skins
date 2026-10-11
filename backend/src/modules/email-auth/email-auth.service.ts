import { createHmac, randomInt, randomUUID } from "node:crypto";

import { BadRequestException, Inject, Injectable, Optional, UnauthorizedException } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import { NotificationOutboxService } from "../notifications/notification-outbox.service";
import { digestToken } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { UsersService } from "../users/users.service";

const OTP_TTL_MILLISECONDS = 10 * 60 * 1_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RETRY_COOLDOWN_MILLISECONDS = 60 * 1_000;

export type EmailAuthRuntime = {
  createCode: () => string;
  now: () => Date;
};

export type EmailVerificationChallenge = {
  id: string;
  resendAvailableAt: string;
};

export type VerifiedEmailAuth = {
  email: string;
  sessionMaximumAgeSeconds: number;
  sessionToken: string;
  userId: string;
};

type ChallengePurpose = "sign_in" | "link_email";

type StoredChallenge = {
  purpose: ChallengePurpose;
  targetUserId: string | null;
  targetSessionDigest: string | null;
  attemptCount: number;
  cancelledAt: Date | null;
  codeDigest: string;
  consumedAt: Date | null;
  email: string;
  expiresAt: Date;
  id: string;
  resendAvailableAt: Date;
};

function normalizeEmail(value: string): string {
  const email = value.trim().toLocaleLowerCase("ru-RU");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Email is invalid");
  return email;
}

function otpSecret(): string {
  return process.env.EMAIL_OTP_PEPPER ?? process.env.COOKIE_HMAC_SECRET ?? "shards-development-email-otp-secret";
}

function digestOtp(challengeId: string, code: string): string {
  return createHmac("sha256", otpSecret()).update(`${challengeId}:${code}`, "utf8").digest("hex");
}

@Injectable()
export class EmailAuthRuntimeProvider implements EmailAuthRuntime {
  createCode(): string {
    return String(randomInt(100_000, 1_000_000));
  }

  now(): Date {
    return new Date();
  }
}

@Injectable()
export class EmailAuthService {
  private readonly challenges = new Map<string, StoredChallenge>();
  private readonly runtime: EmailAuthRuntime;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(EmailAuthRuntimeProvider) runtime: EmailAuthRuntime,
    @Optional() @Inject(NotificationOutboxService) private readonly notifications?: NotificationOutboxService,
  ) {
    this.runtime = runtime;
  }

  async requestChallenge(emailInput: string, options: { purpose: ChallengePurpose; presentedSessionToken: string | null } = { purpose: "sign_in", presentedSessionToken: null }): Promise<EmailVerificationChallenge> {
    const email = normalizeEmail(emailInput);
    const now = this.runtime.now();
    const current = options.presentedSessionToken ? await this.sessions.authenticate(options.presentedSessionToken) : null;
    if (options.purpose === "link_email" && !current) throw new UnauthorizedException("Session is required for linking email");
    if (options.purpose === "sign_in" && current) throw new BadRequestException("Use link_email for the current account");
    const targetUserId = options.purpose === "link_email" ? current?.userId ?? null : null;
    const targetSessionDigest = options.purpose === "link_email" && options.presentedSessionToken ? digestToken(options.presentedSessionToken) : null;
    const existing = await this.findLatestActiveChallenge(email, now, options.purpose, targetSessionDigest);
    if (existing !== null && existing.resendAvailableAt.getTime() > now.getTime()) {
      return { id: existing.id, resendAvailableAt: existing.resendAvailableAt.toISOString() };
    }
    if (existing !== null) await this.cancelChallenge(existing.id, now);

    const id = randomUUID();
    const code = this.runtime.createCode();
    if (!/^\d{6}$/.test(code)) throw new Error("EMAIL_OTP_GENERATOR_INVALID");
    const challenge: StoredChallenge = {
      purpose: options.purpose, targetUserId, targetSessionDigest,
      id,
      email,
      codeDigest: digestOtp(id, code),
      attemptCount: 0,
      expiresAt: new Date(now.getTime() + OTP_TTL_MILLISECONDS),
      resendAvailableAt: new Date(now.getTime() + OTP_RETRY_COOLDOWN_MILLISECONDS),
      consumedAt: null,
      cancelledAt: null,
    };

    if (this.database.isConfigured()) {
      await this.database.query(
        `
          INSERT INTO email_verification_challenges (
            id, email, purpose, code_digest, expires_at, attempt_count, resend_available_at, target_user_id, target_session_digest
          )
          VALUES ($1, $2, $6, $3, $4, 0, $5, $7, $8)
        `,
        [challenge.id, challenge.email, challenge.codeDigest, challenge.expiresAt, challenge.resendAvailableAt, challenge.purpose, targetUserId, targetSessionDigest],
      );
    } else {
      this.challenges.set(challenge.id, challenge);
    }

    await this.notifications?.enqueue({
      channel: "email",
      eventType: "email.verification",
      entityId: challenge.id,
      idempotencyKey: `email-verification/${challenge.id}`,
      payload: {
        challengeId: challenge.id,
        email: challenge.email,
        expireMinutes: OTP_TTL_MILLISECONDS / 60_000,
        otp: code,
      },
    });

    return { id: challenge.id, resendAvailableAt: challenge.resendAvailableAt.toISOString() };
  }

  async verifyChallenge(command: {
    challengeId: string;
    code: string;
    presentedSessionToken: string | null;
  }): Promise<VerifiedEmailAuth> {
    const now = this.runtime.now();
    const challenge = await this.findChallenge(command.challengeId);
    if (
      challenge === null
      || challenge.cancelledAt !== null
      || challenge.consumedAt !== null
      || challenge.expiresAt.getTime() <= now.getTime()
      || challenge.attemptCount >= OTP_MAX_ATTEMPTS
      || !/^\d{6}$/.test(command.code)
      || digestOtp(challenge.id, command.code) !== challenge.codeDigest
    ) {
      if (challenge !== null && challenge.cancelledAt === null && challenge.consumedAt === null && challenge.expiresAt.getTime() > now.getTime()) {
        await this.recordFailedAttempt(challenge, now);
      }
      throw new UnauthorizedException("Email verification code is invalid or expired");
    }

    const currentCustomer = command.presentedSessionToken
      ? await this.sessions.authenticate(command.presentedSessionToken)
      : null;
    if (challenge.purpose === "link_email" && (!currentCustomer || currentCustomer.userId !== challenge.targetUserId || !command.presentedSessionToken || digestToken(command.presentedSessionToken) !== challenge.targetSessionDigest)) {
      throw new UnauthorizedException("Email challenge belongs to a different session");
    }
    if (challenge.purpose === "sign_in" && currentCustomer) throw new UnauthorizedException("Sign-in challenge cannot replace an active account");
    const consumed = await this.consumeChallenge(challenge.id, now);
    if (!consumed) throw new UnauthorizedException("Email verification code is invalid or expired");
    const user = await this.users.upsertEmailUser(challenge.email, challenge.targetUserId ?? undefined);
    const session = await this.sessions.createSession(user.id, command.presentedSessionToken);
    return {
      email: challenge.email,
      sessionMaximumAgeSeconds: session.maximumAgeSeconds,
      sessionToken: session.token,
      userId: user.id,
    };
  }

  private async findLatestActiveChallenge(email: string, now: Date, purpose: ChallengePurpose, targetSessionDigest: string | null): Promise<StoredChallenge | null> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{
        purpose: ChallengePurpose;
        target_user_id: string | null;
        target_session_digest: string | null;
        attempt_count: number;
        cancelled_at: Date | null;
        code_digest: string;
        consumed_at: Date | null;
        email: string;
        expires_at: Date;
        id: string;
        resend_available_at: Date;
      }>(
        `
          SELECT id, email, purpose, target_user_id, target_session_digest, code_digest, attempt_count, expires_at, resend_available_at, consumed_at, cancelled_at
          FROM email_verification_challenges
          WHERE email = $1
            AND purpose = $3 AND target_session_digest IS NOT DISTINCT FROM $4
            AND consumed_at IS NULL
            AND cancelled_at IS NULL
            AND expires_at > $2
          ORDER BY created_at DESC, id DESC
          LIMIT 1
        `,
        [email, now, purpose, targetSessionDigest],
      );
      return this.rowToChallenge(result.rows[0]);
    }
    return [...this.challenges.values()]
      .filter((challenge) => challenge.email === email && challenge.purpose === purpose && challenge.targetSessionDigest === targetSessionDigest && challenge.consumedAt === null && challenge.cancelledAt === null && challenge.expiresAt > now)
      .sort((left, right) => right.id.localeCompare(left.id))[0] ?? null;
  }

  private async findChallenge(id: string): Promise<StoredChallenge | null> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{
        purpose: ChallengePurpose;
        target_user_id: string | null;
        target_session_digest: string | null;
        attempt_count: number;
        cancelled_at: Date | null;
        code_digest: string;
        consumed_at: Date | null;
        email: string;
        expires_at: Date;
        id: string;
        resend_available_at: Date;
      }>(
        `
          SELECT id, email, purpose, target_user_id, target_session_digest, code_digest, attempt_count, expires_at, resend_available_at, consumed_at, cancelled_at
          FROM email_verification_challenges
          WHERE id = $1
          LIMIT 1
        `,
        [id],
      );
      return this.rowToChallenge(result.rows[0]);
    }
    return this.challenges.get(id) ?? null;
  }

  private rowToChallenge(row: {
    purpose: ChallengePurpose;
    target_user_id: string | null;
    target_session_digest: string | null;
    attempt_count: number;
    cancelled_at: Date | null;
    code_digest: string;
    consumed_at: Date | null;
    email: string;
    expires_at: Date;
    id: string;
    resend_available_at: Date;
  } | undefined): StoredChallenge | null {
    if (row === undefined) return null;
    return {
      purpose: row.purpose, targetUserId: row.target_user_id, targetSessionDigest: row.target_session_digest,
      id: row.id,
      email: row.email,
      codeDigest: row.code_digest,
      attemptCount: row.attempt_count,
      expiresAt: row.expires_at,
      resendAvailableAt: row.resend_available_at,
      consumedAt: row.consumed_at,
      cancelledAt: row.cancelled_at,
    };
  }

  private async cancelChallenge(id: string, now: Date): Promise<void> {
    if (this.database.isConfigured()) {
      await this.database.query(
        "UPDATE email_verification_challenges SET cancelled_at = $2 WHERE id = $1 AND consumed_at IS NULL AND cancelled_at IS NULL",
        [id, now],
      );
      return;
    }
    const challenge = this.challenges.get(id);
    if (challenge !== undefined) this.challenges.set(id, { ...challenge, cancelledAt: now });
  }

  private async recordFailedAttempt(challenge: StoredChallenge, now: Date): Promise<void> {
    const attemptCount = challenge.attemptCount + 1;
    if (this.database.isConfigured()) {
      await this.database.query(
        `
          UPDATE email_verification_challenges
          SET attempt_count = attempt_count + 1,
              cancelled_at = CASE WHEN attempt_count + 1 >= $2 THEN $3 ELSE cancelled_at END
          WHERE id = $1
            AND consumed_at IS NULL
            AND cancelled_at IS NULL
        `,
        [challenge.id, OTP_MAX_ATTEMPTS, now],
      );
      return;
    }
    this.challenges.set(challenge.id, {
      ...challenge,
      attemptCount,
      ...(attemptCount >= OTP_MAX_ATTEMPTS ? { cancelledAt: now } : {}),
    });
  }

  private async consumeChallenge(id: string, now: Date): Promise<boolean> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{ id: string }>(
        `
          UPDATE email_verification_challenges
          SET consumed_at = $2
          WHERE id = $1
            AND consumed_at IS NULL
            AND cancelled_at IS NULL
            AND expires_at > $2
            AND attempt_count < $3
          RETURNING id
        `,
        [id, now, OTP_MAX_ATTEMPTS],
      );
      return result.rows.length === 1;
    }
    const challenge = this.challenges.get(id);
    if (challenge === undefined || challenge.consumedAt !== null || challenge.cancelledAt !== null) return false;
    this.challenges.set(id, { ...challenge, consumedAt: now });
    return true;
  }
}
