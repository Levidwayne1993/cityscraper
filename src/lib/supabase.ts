import { createClient } from '@supabase/supabase-js';

// ============================================================
//  CITYSCRAPER — Supabase Client Factory
//  Creates clients for CityScraper DB + each target site DB
// ============================================================

// ---------- CITYSCRAPER (main aggregator DB) ----------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client-side (browser) — uses anon key, respects RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server-side — uses service role, bypasses RLS for scraping/pushing
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// ---------- TARGET SITE CLIENTS ----------

// YardShoppers.com
export function getYardShoppersClient() {
  return createClient(
    process.env.YARDSHOPPERS_SUPABASE_URL!,
    process.env.YARDSHOPPERS_SUPABASE_KEY!
  );
}

// CheapHouseHub.com
export function getCheapHouseHubClient() {
  return createClient(
    process.env.CHEAPHOUSEHUB_SUPABASE_URL!,
    process.env.CHEAPHOUSEHUB_SUPABASE_KEY!
  );
}

// CryptoToolbox.org
export function getCryptoToolboxClient() {
  return createClient(
    process.env.CRYPTOTOOLBOX_SUPABASE_URL!,
    process.env.CRYPTOTOOLBOX_SUPABASE_KEY!
  );
}

// ---------- HELPERS ----------

export async function logScrapeRun(
  pipeline: string,
  status: 'running' | 'success' | 'error',
  itemsFound: number = 0,
  itemsPushed: number = 0,
  errors: number = 0,
  durationMs: number | null = null,
  errorMessage: string | null = null
) {
  const { error } = await supabaseAdmin.from('scrape_logs').insert({
    pipeline,
    target: pipeline,
    status,

    items_found: itemsFound,
    items_pushed: itemsPushed,
    errors,
    duration_ms: durationMs,
    error_message: errorMessage,
    started_at: new Date().toISOString(),
    completed_at: status !== 'running' ? new Date().toISOString() : null,
  });

  if (error) console.error('Failed to log scrape run:', error);
}

export async function updateScrapeLog(
  logId: string,
  updates: {
    status?: string;
    items_found?: number;
    items_pushed?: number;
    errors?: number;
    duration_ms?: number;
    error_message?: string;
    completed_at?: string;
  }
) {
  const { error } = await supabaseAdmin
    .from('scrape_logs')
    .update(updates)
    .eq('id', logId);

  if (error) console.error('Failed to update scrape log:', error);
}
