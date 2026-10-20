import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { config } from './config/config.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  // rawBody: Stripe's webhooks are checked against the exact bytes it signed
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  // behind a proxy, read the client's address from X-Forwarded-For (rate limits are per client)
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  // on SIGTERM (a deploy, a scale-down): finish requests and close the database pool
  app.enableShutdownHooks();
  // an event's cover image arrives as the request body itself (already resized by the browser)
  app.useBodyParser('raw', { type: ['image/webp', 'image/jpeg', 'image/png'], limit: '2mb' });
  // reads the refresh token cookie
  app.use(cookieParser());
  // the frontend calls the API from another origin, with cookies
  app.enableCors({ origin: config.appUrl, credentials: true });
  if (config.swaggerEnabled) setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
