import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DatabaseService } from "../../common/database/database.service";
import type { VerifiedSteamIdentity } from "./steam-identity";
import type { SteamTradeCredential } from "./steam-trade-url";

export type CustomerUser = {
  id: string;
  steam: {
    connected: boolean;
    steamId64?: string;
  };
  email?: {
    address: string;
    verified: true;
  };
};

export type EncryptedSteamTradeCredential = {
  partner: string;
  ciphertext: string;
  nonce: string;
  authTag: string;
};

function encryptionKey(): Buffer {
  return createHash("sha256")
    .update(process.env.DATA_ENCRYPTION_SECRET ?? "shards-development-data-secret", "utf8")
    .digest();
}

function encryptCredential(credential: SteamTradeCredential): EncryptedSteamTradeCredential {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(credential), "utf8"),
    cipher.final(),
  ]);
  return {
    partner: credential.partner,
    ciphertext: ciphertext.toString("base64url"),
    nonce: nonce.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
  };
}

export function decryptCredential(envelope: EncryptedSteamTradeCredential): SteamTradeCredential {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(envelope.nonce, "base64url"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
  const parsed = JSON.parse(plaintext.toString("utf8")) as SteamTradeCredential;
  if (parsed.partner !== envelope.partner) throw new Error("Stored Steam trade credential is malformed");
  return parsed;
}

function normalizeEmail(emailInput: string): string {
  const email = emailInput.trim().toLocaleLowerCase("ru-RU");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new NotFoundException("Email is invalid");
  return email;
}

@Injectable()
export class UsersService {
  private readonly usersById = new Map<string, CustomerUser>();
  private readonly idsBySteamId64 = new Map<string, string>();
  private readonly idsByEmail = new Map<string, string>();
  private readonly steamTradeCredentialsByUserId = new Map<string, EncryptedSteamTradeCredential>();

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async upsertSteamUser(identity: VerifiedSteamIdentity): Promise<CustomerUser> {
    if (this.database.isConfigured()) {
      const userId = `user_${identity.steamId64}`;
      const result = await this.database.query<{ id: string; steam_id64: string }>(
        `
          INSERT INTO users (id, steam_id64)
          VALUES ($1, $2)
          ON CONFLICT (steam_id64) DO UPDATE
          SET updated_at = clock_timestamp()
          RETURNING id, steam_id64
        `,
        [userId, identity.steamId64],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Steam user was not stored");
      return {
        id: row.id,
        steam: {
          connected: true,
          steamId64: row.steam_id64,
        },
      };
    }

    const userId = this.idsBySteamId64.get(identity.steamId64) ?? `user_${identity.steamId64}`;
    const existing = this.usersById.get(userId);
    const next: CustomerUser = {
      ...existing,
      id: userId,
      steam: {
        connected: true,
        steamId64: identity.steamId64,
      },
    };
    this.usersById.set(userId, next);
    this.idsBySteamId64.set(identity.steamId64, userId);
    return next;
  }

  async upsertEmailUser(emailInput: string, targetUserId?: string): Promise<CustomerUser> {
    const email = normalizeEmail(emailInput);
    if (this.database.isConfigured()) {
      if (targetUserId !== undefined) {
        await this.requireUser(targetUserId);
        await this.database.transaction(async (client) => {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email:${email}`]);
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`email-owner:${targetUserId}`]);
          const prior = await client.query<{email:string}>("SELECT email FROM email_identities WHERE user_id=$1",[targetUserId]);
          if (prior.rows[0] && prior.rows[0].email !== email) throw new ConflictException({code:"ACCOUNT_EMAIL_EXISTS", message:"У аккаунта уже есть подтверждённая почта"});
          const linked = await client.query<{user_id:string}>(`INSERT INTO email_identities (email,user_id,verified_at) VALUES ($1,$2,clock_timestamp()) ON CONFLICT (email) DO UPDATE SET verified_at=clock_timestamp(),updated_at=clock_timestamp() WHERE email_identities.user_id=EXCLUDED.user_id RETURNING user_id`, [email,targetUserId]);
          if (!linked.rows[0]) throw new ConflictException({code:"EMAIL_ALREADY_LINKED", message:"Эта почта привязана к другому аккаунту"});
        });
        return this.requireUser(targetUserId);
      }
      const userId = `user_email_${createHash("sha256").update(email, "utf8").digest("hex").slice(0, 32)}`;
      const result = await this.database.query<{ user_id: string }>(
        `
          WITH existing_identity AS (
            SELECT user_id AS id
            FROM email_identities
            WHERE email = $2
          ), target_user AS (
            SELECT id, steam_id64
            FROM users
            WHERE id = $3
              AND disabled = false
              AND $3 IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM existing_identity)
          ), inserted_email_user AS (
            INSERT INTO users (id, steam_id64)
            SELECT $1, NULL
            WHERE NOT EXISTS (SELECT 1 FROM target_user)
              AND NOT EXISTS (SELECT 1 FROM existing_identity)
            ON CONFLICT (id) DO UPDATE
            SET updated_at = clock_timestamp()
            RETURNING id, steam_id64
          ), selected_user AS (
            SELECT id FROM existing_identity
            UNION ALL
            SELECT id
            FROM target_user
            UNION ALL
            SELECT id
            FROM inserted_email_user
            WHERE NOT EXISTS (SELECT 1 FROM target_user)
          ), upserted_identity AS (
            INSERT INTO email_identities (email, user_id, verified_at)
            SELECT $2, selected_user.id, clock_timestamp()
            FROM selected_user
            ON CONFLICT (email) DO UPDATE
            SET verified_at = clock_timestamp(),
                updated_at = clock_timestamp()
            RETURNING user_id, email
          )
          SELECT user_id FROM upserted_identity
          LIMIT 1
        `,
        [userId, email, null],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Email user was not stored");
      return this.requireUser(row.user_id);
    }

    const owner = this.idsByEmail.get(email);
    if (targetUserId !== undefined && owner !== undefined && owner !== targetUserId) throw new ConflictException({code:"EMAIL_ALREADY_LINKED", message:"Эта почта привязана к другому аккаунту"});
    const userId = this.idsByEmail.get(email) ?? targetUserId ?? `user_email_${createHash("sha256").update(email, "utf8").digest("hex").slice(0, 32)}`;
    const existing = this.usersById.get(userId);
    const next: CustomerUser = {
      ...existing,
      id: userId,
      email: { address: email, verified: true },
      steam: existing?.steam ?? { connected: false },
    };
    this.usersById.set(userId, next);
    this.idsByEmail.set(email, userId);
    return next;
  }

  async requireUser(userId: string): Promise<CustomerUser> {
    if (this.database.isConfigured()) {
      const result = await this.database.query<{ id: string; steam_id64: string | null; email: string | null }>(
        `
          SELECT users.id, users.steam_id64, email_identities.email
          FROM users
          LEFT JOIN email_identities ON email_identities.user_id = users.id
          WHERE users.id = $1 AND users.disabled = false
          LIMIT 1
        `,
        [userId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException("User not found");
      return {
        id: row.id,
        ...(row.email === null ? {} : { email: { address: row.email, verified: true as const } }),
        steam: row.steam_id64 === null ? { connected: false } : { connected: true, steamId64: row.steam_id64 },
      };
    }

    const user = this.usersById.get(userId);
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async saveSteamTradeCredential(userId: string, credential: SteamTradeCredential): Promise<void> {
    await this.requireUser(userId);
    const encrypted = encryptCredential(credential);
    if (this.database.isConfigured()) {
      await this.database.query(
        `
          INSERT INTO steam_trade_credentials (
            user_id,
            partner_account_id,
            key_version,
            cipher_version,
            ciphertext,
            nonce,
            auth_tag
          )
          VALUES ($1, $2, 'v1', 'aes-256-gcm', $3, $4, $5)
          ON CONFLICT (user_id) DO UPDATE
          SET partner_account_id = EXCLUDED.partner_account_id,
              key_version = EXCLUDED.key_version,
              cipher_version = EXCLUDED.cipher_version,
              ciphertext = EXCLUDED.ciphertext,
              nonce = EXCLUDED.nonce,
              auth_tag = EXCLUDED.auth_tag,
              updated_at = clock_timestamp()
        `,
        [userId, encrypted.partner, encrypted.ciphertext, encrypted.nonce, encrypted.authTag],
      );
      return;
    }

    this.steamTradeCredentialsByUserId.set(userId, encrypted);
  }

  async hasSteamTradeCredential(userId: string): Promise<boolean> {
    await this.requireUser(userId);
    if (this.database.isConfigured()) {
      const result = await this.database.query<{ exists: boolean }>(
        "SELECT EXISTS (SELECT 1 FROM steam_trade_credentials WHERE user_id = $1) AS exists",
        [userId],
      );
      return result.rows[0]?.exists ?? false;
    }

    return this.steamTradeCredentialsByUserId.has(userId);
  }

  async requireSteamTradeCredential(userId: string): Promise<SteamTradeCredential> {
    await this.requireUser(userId);
    if (this.database.isConfigured()) {
      const result = await this.database.query<{
        partner_account_id: string;
        ciphertext: string;
        nonce: string;
        auth_tag: string;
      }>(
        `
          SELECT partner_account_id, ciphertext, nonce, auth_tag
          FROM steam_trade_credentials
          WHERE user_id = $1
          LIMIT 1
        `,
        [userId],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException("Steam Trade URL is not configured");
      return decryptCredential({
        partner: row.partner_account_id,
        ciphertext: row.ciphertext,
        nonce: row.nonce,
        authTag: row.auth_tag,
      });
    }

    const envelope = this.steamTradeCredentialsByUserId.get(userId);
    if (!envelope) throw new NotFoundException("Steam Trade URL is not configured");
    return decryptCredential(envelope);
  }
}
