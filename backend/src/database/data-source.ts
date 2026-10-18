import 'dotenv/config';
import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';

/**
 * Used only by the TypeORM CLI (pnpm migration:*, or migration:run:prod from
 * the build), never by the running app.
 * Connects as the schema owner, which can run DDL; the app connects as a
 * limited role through DATABASE_URL instead.
 */
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  throw new Error('Missing environment variable: MIGRATION_DATABASE_URL');
}

const here = fileURLToPath(new URL('.', import.meta.url));
// .ts from source (development, tsx), .js from the build (production image)
const ext = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

export default new DataSource({
  type: 'postgres',
  url,
  // entities are only needed for migration:generate / migration:check
  entities: [`${here}../modules/**/entities/*.entity.${ext}`],
  migrations: [`${here}migrations/*.${ext}`],
  // one transaction for the whole run: a failing migration leaves nothing behind
  migrationsTransactionMode: 'all',
  installExtensions: false,
  // generated migrations use gen_random_uuid() (built in), matching the schema
  uuidExtension: 'pgcrypto',
});
