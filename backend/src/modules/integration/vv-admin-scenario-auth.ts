import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import type { AppConfig } from "../../config/app-config";
import { APP_CONFIG } from "../../config/app-config.module";
import { optionalStringFromFile } from "../../config/secret-file";

@Injectable()
export class VvAdminScenarioAuthVerifier {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  verify(input: {
    readonly body: string;
    readonly path: string;
    readonly signature: string;
    readonly timestamp: string;
  }): boolean {
    const secret = optionalStringFromFile(
      this.config.integration.protocolAuthSecretFile,
    );
    if (!secret) return false;
    const bodyHash = createHash("sha256").update(input.body).digest("hex");
    const expected = createHmac("sha256", secret)
      .update(["POST", input.path, input.timestamp, bodyHash].join("\n"))
      .digest("hex");
    return safeEqual(expected, input.signature);
  }
}

function safeEqual(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}
