import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { config } from './config/config.js';
import { setupSwagger } from './swagger.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // reads the refresh token cookie
  app.use(cookieParser());
  // the frontend calls the API from another origin, with cookies
  app.enableCors({ origin: config.appUrl, credentials: true });
  if (config.swaggerEnabled) setupSwagger(app);
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
