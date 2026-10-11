import { BadRequestException, Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiResponse } from "@nestjs/swagger";

import { CUSTOMER_SESSION_COOKIE, parseExactCookie, secureCustomerSessionCookie } from "../sessions/session-cookies";
import { EmailAuthService, type EmailVerificationChallenge, type VerifiedEmailAuth } from "./email-auth.service";

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Request body is invalid");
  return value as Record<string, unknown>;
}

@Controller("auth/email")
export class EmailAuthController {
  constructor(@Inject(EmailAuthService) private readonly emailAuth: EmailAuthService) {}

  @HttpCode(202)
  @Post("challenges")
  @ApiResponse({ status: 202, schema: { type: "object", required: ["id", "resendAvailableAt"], properties: { id: { type: "string" }, resendAvailableAt: { type: "string" } } } })
  requestChallenge(@Body() body: unknown): Promise<EmailVerificationChallenge> {
    const email = readRecord(body).email;
    if (typeof email !== "string") throw new BadRequestException("Email is invalid");
    return this.emailAuth.requestChallenge(email);
  }

  @Post("challenges/:challengeId/verify")
  async verifyChallenge(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Pick<VerifiedEmailAuth, "email" | "userId">> {
    const record = readRecord(body);
    const challengeId = request.params.challengeId;
    if (typeof challengeId !== "string" || typeof record.code !== "string") throw new BadRequestException("Verification code is invalid");
    const completed = await this.emailAuth.verifyChallenge({
      challengeId,
      code: record.code,
      presentedSessionToken: parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE),
    });
    response.setHeader("Set-Cookie", secureCustomerSessionCookie(completed.sessionToken, completed.sessionMaximumAgeSeconds));
    return { email: completed.email, userId: completed.userId };
  }
}
