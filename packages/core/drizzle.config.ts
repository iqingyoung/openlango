import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'drizzle-kit';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbFile = process.env.OPENLANGO_DB_URL ?? 'data/openlango.db';
mkdirSync(dirname(resolve(root, dbFile)), { recursive: true });

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: resolve(root, dbFile) },
});
