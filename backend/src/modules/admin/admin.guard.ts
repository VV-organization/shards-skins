import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CanActivate, ExecutionContext, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";

import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";

type HeaderRequest = {
  headers: Record<string, string | string[] | undefined>;
};

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const tokenFile = this.config.admin.apiTokenFile;
    if (tokenFile === undefined) throw new ServiceUnavailableException("Admin API token is not configured");
    const expected = (await readFile(tokenFile, "utf8")).trim();
    if (expected.length < 16) throw new ServiceUnavailableException("Admin API token is invalid");
    const request = context.switchToHttp().getRequest<HeaderRequest>();
    const provided = singleHeader(request.headers["x-admin-token"])?.trim();
    if (provided === undefined || !constantTimeEqual(provided, expected)) throw new UnauthorizedException();
    return true;
  }
}
