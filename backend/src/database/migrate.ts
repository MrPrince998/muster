import dataSource from './data-source.js';

/**
 * Runs pending migrations, quietly: one line per migration, and errors.
 * The TypeORM CLI logs every query it runs, thousands of lines on a first
 * deploy, which hosts like Railway rate-limit (and drop). The production
 * image runs this before the API starts; a failure exits non-zero, so the
 * API never starts on a half-migrated schema (all migrations run in one
 * transaction: nothing is left behind).
 */
async function migrate(): Promise<void> {
  dataSource.setOptions({ logging: ['error'] });
  await dataSource.initialize();
  try {
    const ran = await dataSource.runMigrations({ transaction: 'all' });
    for (const migration of ran) console.log(`Migrated: ${migration.name}`);
    console.log(ran.length ? `${ran.length} migration${ran.length === 1 ? '' : 's'} run` : 'Database is up to date');
  } finally {
    await dataSource.destroy();
  }
}

migrate().catch((error: unknown) => {
  console.error('Migrations failed:', error);
  process.exit(1);
});
