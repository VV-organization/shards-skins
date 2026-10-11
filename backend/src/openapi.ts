import "reflect-metadata";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { AppModule } from "./app.module";

const openApiPath = resolve(__dirname, "..", "openapi.json");

export async function createOpenApiJson(): Promise<string> {
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();

  const config = new DocumentBuilder()
    .setTitle("Shards API")
    .setDescription("Backend-owned API contract for Shards digital-goods storefront.")
    .setVersion("0.1.0")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  await app.close();
  return `${JSON.stringify(document, null, 2)}\n`;
}

async function main(): Promise<void> {
  const nextDocument = await createOpenApiJson();

  if (process.argv.includes("--check")) {
    if (!existsSync(openApiPath)) {
      throw new Error("backend/openapi.json is missing. Run npm --prefix backend run openapi:generate.");
    }
    const currentDocument = readFileSync(openApiPath, "utf8");
    if (currentDocument !== nextDocument) {
      throw new Error("backend/openapi.json is stale. Run npm --prefix backend run openapi:generate.");
    }
    return;
  }

  writeFileSync(openApiPath, nextDocument);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
