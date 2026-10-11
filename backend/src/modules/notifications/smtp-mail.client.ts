import { readFileSync } from "node:fs";

import { Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import type { AppConfig } from "../../config/app-config";

export type MailSendInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export type MailGateway = {
  send(input: MailSendInput): Promise<{ emailId: string }>;
};

type MailTransport = {
  sendMail(message: Mail.Options): Promise<SMTPTransport.SentMessageInfo>;
};
type MailTransportFactory = (options: SMTPTransport.Options) => MailTransport;

@Injectable()
export class SmtpMailClient implements MailGateway {
  private readonly from: string | null;
  private readonly transport: MailTransport | null;

  constructor(config: AppConfig, transportFactory: MailTransportFactory = (options) => nodemailer.createTransport(options)) {
    this.from = config.notifications.smtpFrom ?? null;
    this.transport = this.createTransport(config, transportFactory);
  }

  isConfigured(): boolean {
    return this.transport !== null && this.from !== null;
  }

  async send(input: MailSendInput): Promise<{ emailId: string }> {
    if (this.transport === null || this.from === null) throw new Error("SMTP_NOT_CONFIGURED");
    if (input.from !== this.from) throw new Error("SMTP_FROM_MISMATCH");
    const response = await this.transport.sendMail({
      from: input.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: {
        "X-Shards-Idempotency-Key": input.idempotencyKey,
      },
    } satisfies Mail.Options);
    return { emailId: messageIdFromResponse(response) };
  }

  private createTransport(config: AppConfig, transportFactory: MailTransportFactory): MailTransport | null {
    const username = config.notifications.smtpUsername;
    const passwordFile = config.notifications.smtpPasswordFile;
    if (username === undefined || passwordFile === undefined) return null;
    return transportFactory({
      host: config.notifications.smtpHost,
      port: config.notifications.smtpPort,
      secure: config.notifications.smtpSecure,
      auth: {
        user: username,
        pass: readSecret(passwordFile),
      },
    });
  }
}

function messageIdFromResponse(response: unknown): string {
  if (response && typeof response === "object" && "messageId" in response && typeof response.messageId === "string" && response.messageId.length > 0) {
    return response.messageId;
  }
  return "smtp-accepted";
}

function readSecret(path: string): string {
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error("SMTP_SECRET_FILE_EMPTY");
  return value;
}
