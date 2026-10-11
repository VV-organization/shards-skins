import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiBody, ApiResponse } from "@nestjs/swagger";

import { CUSTOMER_SESSION_COOKIE, parseExactCookie, secureCustomerSessionCookie } from "../sessions/session-cookies";
import { SessionsService } from "../sessions/sessions.service";
import { EmailAuthService, type EmailVerificationChallenge, type VerifiedEmailAuth } from "./email-auth.service";

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException("Request body is invalid");
  return value as Record<string, unknown>;
}

@Controller("auth/email")
export class EmailAuthController {
  constructor(@Inject(EmailAuthService) private readonly emailAuth: EmailAuthService, @Inject(SessionsService) private readonly sessions: SessionsService) {}

  @HttpCode(202)
  @Post("challenges")
  @ApiResponse({ status: 202, schema: { type: "object", required: ["id", "resendAvailableAt"], properties: { id: { type: "string" }, resendAvailableAt: { type: "string" } } } })
  @ApiBody({ schema: { type: "object", required: ["email", "purpose"], properties: { email: {type:"string",format:"email"}, purpose:{type:"string",enum:["sign_in","link_email"]} } } })
  requestChallenge(@Body() body: unknown, @Req() request: Request): Promise<EmailVerificationChallenge> {
    const email = readRecord(body).email;
    if (typeof email !== "string") throw new BadRequestException("Email is invalid");
    const record = readRecord(body);
    const purpose = record.purpose;
    if (purpose !== "sign_in" && purpose !== "link_email") throw new BadRequestException("Email challenge purpose is required");
    const token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    this.requireCurrentSessionCsrf(request, token);
    return this.emailAuth.requestChallenge(email, {purpose, presentedSessionToken:token});
  }

  @Post("challenges/:challengeId/verify")
  @HttpCode(200)
  @ApiBody({schema:{type:"object",required:["code"],properties:{code:{type:"string",pattern:"^[0-9]{6}$"}}}})
  @ApiResponse({status:200,schema:{type:"object",required:["email","userId"],properties:{email:{type:"string"},userId:{type:"string"}}}})
  async verifyChallenge(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Pick<VerifiedEmailAuth, "email" | "userId">> {
    const record = readRecord(body);
    const challengeId = request.params.challengeId;
    if (typeof challengeId !== "string" || typeof record.code !== "string") throw new BadRequestException("Verification code is invalid");
    const token = parseExactCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    this.requireCurrentSessionCsrf(request, token);
    const completed = await this.emailAuth.verifyChallenge({
      challengeId,
      code: record.code,
      presentedSessionToken: token,
    });
    response.setHeader("Set-Cookie", secureCustomerSessionCookie(completed.sessionToken, completed.sessionMaximumAgeSeconds));
    return { email: completed.email, userId: completed.userId };
  }
  private requireCurrentSessionCsrf(request: Request, token: string | null): void {
    if (token === null) return;
    const csrf = request.headers["x-csrf-token"];
    if (typeof csrf !== "string" || !this.sessions.verifyCsrfToken(token, csrf)) throw new ForbiddenException();
  }

}
