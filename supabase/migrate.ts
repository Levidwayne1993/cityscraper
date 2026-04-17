// ============================================================
// FILE: supabase/migrate.ts
// STATUS: MISSING — referenced in package.json as npm run db:migrate
// PURPOSE: Programmatic migration runner for CityScraper DB
// USAGE: npx tsx supabase/migrate.ts
// NOTE: Supabase JS client does NOT support raw SQL execution.
//       This script reads .sql files and provides two options:
//       1. Auto-run via exec_sql RPC (if you create that function)
//       2. Print SQL for manual execution in Supabase Dashboard
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

interface MigrationResult {
  file: string;
  status: 'success' | 'skipped' | 'error';
  message: string;
}

async function runMigrations(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('[Migrate] Missing environment variables.');
    console.error('[Migrate] Required:');
    console.error('  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co');
    console.error('  SUPABASE_SERVICE_ROLE_KEY=eyJ...');
    console.error('[Migrate] Set them in .env.local or export them before running.');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  console.log('[Migrate] ========================================');
  console.log('[Migrate] CityScraper Database Migration Runner');
  console.log('[Migrate] ========================================');
  console.log(`[Migrate] Connected to: ${supabaseUrl}`);
  console.log('[Migrate] Looking for migration files...');

  // Read migration files in order
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    console.error(`[Migrate] No migrations directory found at: ${migrationsDir}`);
    console.error('[Migrate] Create supabase/migrations/ and add .sql files.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // Alphabetical = execution order (001_, 002_, etc.)

  if (files.length === 0) {
    console.log('[Migrate] No .sql migration files found.');
    process.exit(0);
  }

  console.log(`[Migrate] Found ${files.length} migration(s):`);
  files.forEach((f) => console.log(`  - ${f}`));
  console.log('');

  const results: MigrationResult[] = [];

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    console.log(`[Migrate] Running: ${file}...`);

    try {
      // Attempt using Supabase's rpc if you have an exec_sql function
      // To create it, run this in your Supabase SQL Editor ONCE:
      //
      //   CREATE OR REPLACE FUNCTION exec_sql(query TEXT)
      //   RETURNS VOID AS $$
      //   BEGIN
      //     EXECUTE query;
      //   END;
      //   $$ LANGUAGE plpgsql SECURITY DEFINER;
      //
      const { error } = await supabase.rpc('exec_sql', { query: sql });

      if (error) {
        if (error.message.includes('function') && error.message.includes('does not exist')) {
          // exec_sql function doesn't exist — fall back to manual mode
          console.warn(`[Migrate] exec_sql RPC not found. Switching to manual mode.`);
          console.warn(`[Migrate] To enable auto-migration, run this in your Supabase SQL Editor:`);
          console.warn('');
          console.warn(`  CREATE OR REPLACE FUNCTION exec_sql(query TEXT)`);
          console.warn(`  RETURNS VOID AS $$`);
          console.warn(`  BEGIN`);
          console.warn(`    EXECUTE query;`);
          console.warn(`  END;`);
          console.warn(`  $$ LANGUAGE plpgsql SECURITY DEFINER;`);
          console.warn('');
          console.warn(`[Migrate] For now, run these SQL files manually in the Supabase Dashboard:`);
          console.warn('');

          // Print remaining files for manual execution
          for (const remainingFile of files) {
            const remainingPath = path.join(migrationsDir, remainingFile);
            console.warn(`  --- ${remainingFile} ---`);
            console.warn(fs.readFileSync(remainingPath, 'utf-8'));
            console.warn('');
            results.push({
              file: remainingFile,
              status: 'skipped',
              message: 'exec_sql RPC not available — run manually',
            });
          }
          break;
        } else {
          // Actual SQL error
          console.error(`[Migrate] ERROR in ${file}: ${error.message}`);
          results.push({ file, status: 'error', message: error.message });
        }
      } else {
        console.log(`[Migrate] ✓ ${file} applied successfully`);
        results.push({ file, status: 'success', message: 'Applied' });
      }
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[Migrate] EXCEPTION in ${file}: ${message}`);
      results.push({ file, status: 'error', message });
    }
  }

  // Print summary
  console.log('');
  console.log('[Migrate] ========================================');
  console.log('[Migrate] Migration Summary');
  console.log('[Migrate] ========================================');

  const succeeded = results.filter((r) => r.status === 'success').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const failed = results.filter((r) => r.status === 'error').length;

  results.forEach((r) => {
    const icon = r.status === 'success' ? '✓' : r.status === 'skipped' ? '⊘' : '✗';
    console.log(`  ${icon} ${r.file} — ${r.status}: ${r.message}`);
  });

  console.log('');
  console.log(`[Migrate] Total: ${results.length} | Success: ${succeeded} | Skipped: ${skipped} | Failed: ${failed}`);

  if (failed > 0) {
    console.error('[Migrate] Some migrations failed. Fix errors and re-run.');
    process.exit(1);
  }

  console.log('[Migrate] Done.');
}

// Allow CLI execution: npx tsx supabase/migrate.ts
runMigrations().catch((err) => {
  console.error('[Migrate] Fatal error:', (err as Error).message);
  process.exit(1);
});
