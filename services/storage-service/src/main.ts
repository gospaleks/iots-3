import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadStorageConfig } from './config/storage.config';

async function bootstrap(): Promise<void> {
  const cfg = loadStorageConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  // CORS for an optional browser web app (additive: only sets response headers).
  // CORS_ORIGINS is a comma-separated allowlist; unset or "*" ⇒ reflect any origin (local demo
  // default). Note: the cors lib treats "*" as a wildcard only as a bare string, not inside an
  // array — so wildcard must map to `true` (reflect), which also works for localhost vs 127.0.0.1.
  const corsOrigins = process.env.CORS_ORIGINS?.trim();
  app.enableCors({
    origin:
      !corsOrigins || corsOrigins === '*'
        ? true
        : corsOrigins.split(',').map((o) => o.trim()),
  });
  app.enableShutdownHooks(); // SIGTERM → onModuleDestroy: drain buffer + disconnect broker
  await app.listen(cfg.port, '0.0.0.0');
  new Logger('Bootstrap').log(`storage service listening on :${cfg.port} (writeMode=${cfg.writeMode})`);
}

void bootstrap();
