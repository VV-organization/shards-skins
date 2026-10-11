import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { SmtpMailClient } from "./smtp-mail.client";

describe("SmtpMailClient", () => {
  it("sends mail through the configured SMTP transport without exposing the password", async () => {
    const directory = mkdtempSync(join(tmpdir(), "shards-smtp-"));
    const passwordFile = join(directory, "password");
    writeFileSync(passwordFile, "smtp-password\n", "utf8");
    const sent: unknown[] = [];

    const client = new SmtpMailClient({
      nodeEnv: "test",
      notifications: {
        smtpHost: "smtp.purelymail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: "support@shardsapp24.com",
        smtpPasswordFile: passwordFile,
        smtpFrom: "Shards <support@shardsapp24.com>",
      },
    } as never, (options) => {
      expect(options).toMatchObject({
        host: "smtp.purelymail.com",
        port: 465,
        secure: true,
        auth: { user: "support@shardsapp24.com", pass: "smtp-password" },
      });
      return {
        sendMail: (message) => {
          sent.push(message);
          return Promise.resolve({
            accepted: ["buyer@example.com"],
            envelope: { from: "support@shardsapp24.com", to: ["buyer@example.com"] },
            messageId: "smtp-message-id",
            pending: [],
            rejected: [],
            response: "250 queued",
          });
        },
      };
    });

    await expect(client.send({
      from: "Shards <support@shardsapp24.com>",
      to: "buyer@example.com",
      subject: "Subject",
      text: "plain",
      html: "<p>html</p>",
      idempotencyKey: "email-verification/challenge_1",
    })).resolves.toEqual({ emailId: "smtp-message-id" });
    expect(sent).toEqual([expect.objectContaining({ from: "Shards <support@shardsapp24.com>", to: "buyer@example.com" })]);
  });
});
