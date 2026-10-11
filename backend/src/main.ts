import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module";
import { loadAppConfig } from "./config/app-config";

export async function bootstrap(): Promise<void> {
  const config = loadAppConfig(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  if (config.corsOrigins.length > 0) {
    app.enableCors({ origin: config.corsOrigins, credentials: true });
  }

  await app.listen(config.port);
}

void bootstrap();
