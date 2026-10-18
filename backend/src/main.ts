import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { config } from './config/config.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // behind a proxy, read the client's address from X-Forwarded-For (rate limits are per client)
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);
  // on SIGTERM (a deploy, a scale-down): finish requests and close the database pool
  app.enableShutdownHooks();
  // reads the refresh token cookie
  app.use(cookieParser());
  // the frontend calls the API from another origin, with cookies
  app.enableCors({ origin: config.appUrl, credentials: true });
  if (config.swaggerEnabled) setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
