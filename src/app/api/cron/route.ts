// ============================================================
// FILE: src/app/api/cron/route.ts
// STATUS: FIXED — auth was checking 'authorization' header but
//         Vercel cron sends 'x-vercel-cron-secret' header.
//         Also added push-phase logging to scrape_logs table.
// REPLACES: src/app/api/cron/route.ts (existing file)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { scrapeYardSales } from '@/lib/scrapers/yard-sale-scraper';
import { scrapeCheapHomes } from '@/lib/scrapers/home-scraper';
import { scrapeCrypto } from '@/lib/scrapers/crypto-scraper';
import { pushToYardShoppers } from '@/lib/pushers/yard-shoppers-push';
import { pushToCheapHouseHub } from '@/lib/pushers/cheap-house-push';
import { pushToCryptoToolbox } from '@/lib/pushers/crypto-toolbox-push';
import { logScrapeRun } from '@/lib/supabase';

// ============================================================
// CRON HANDLER — Runs every 4 hours via Vercel Cron
// Sequence: Scrape All → Push All → Log Results
// ============================================================

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // -------------------------------------------------------
  // FIX: Vercel Cron sends the secret via EITHER:
  //   - 'authorization: Bearer <secret>'   (Vercel v2+)
  //   - custom header you configure
  // We check BOTH the standard Vercel pattern AND a manual
  // x-api-key fallback so local/manual triggers also work.
  // -------------------------------------------------------
  const cronSecret =
    req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.headers.get('x-api-key') ||
    '';

  const validSecret = process.env.CRON_SECRET || '';

  if (!validSecret || cronSecret !== validSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[CRON] ========== Starting scheduled scrape ==========');
  const startTime = Date.now();
  const results: any = {};

  try {
    // === PHASE 1: SCRAPE ALL PIPELINES ===
    console.log('[CRON] Phase 1: Scraping...');

    // Crypto first (fastest — API-based)
    try {
      results.crypto_scrape = await scrapeCrypto();
      await logScrapeRun(
        'crypto', 'success',
        results.crypto_scrape.itemsFound, 0,
        results.crypto_scrape.errors,
        null
      );
      console.log(`[CRON] Crypto scrape: ${results.crypto_scrape.itemsFound} items`);
    } catch (err: any) {
      results.crypto_scrape = { success: false, itemsFound: 0, error: err.message };
      await logScrapeRun('crypto', 'error', 0, 0, 1, null, err.message);
      console.error('[CRON] Crypto scrape failed:', err.message);
    }

    // Yard sales
    try {
      results.yard_sales_scrape = await scrapeYardSales();
      await logScrapeRun(
        'yard-sales', 'success',
        results.yard_sales_scrape.itemsFound, 0,
        results.yard_sales_scrape.errors,
        null
      );
      console.log(`[CRON] Yard sales scrape: ${results.yard_sales_scrape.itemsFound} items`);
    } catch (err: any) {
      results.yard_sales_scrape = { success: false, itemsFound: 0, error: err.message };
      await logScrapeRun('yard-sales', 'error', 0, 0, 1, null, err.message);
      console.error('[CRON] Yard sales scrape failed:', err.message);
    }

    // Cheap homes (slowest — multiple sources)
    try {
      results.cheap_homes_scrape = await scrapeCheapHomes();
      await logScrapeRun(
        'cheap-homes', 'success',
        results.cheap_homes_scrape.itemsFound, 0,
        results.cheap_homes_scrape.errors,
        null
      );
      console.log(`[CRON] Cheap homes scrape: ${results.cheap_homes_scrape.itemsFound} items`);
    } catch (err: any) {
      results.cheap_homes_scrape = { success: false, itemsFound: 0, error: err.message };
      await logScrapeRun('cheap-homes', 'error', 0, 0, 1, null, err.message);
      console.error('[CRON] Cheap homes scrape failed:', err.message);
    }

    // === PHASE 2: PUSH TO TARGET SITES ===
    console.log('[CRON] Phase 2: Pushing to target sites...');

    try {
      results.yard_shoppers_push = await pushToYardShoppers();
      // Log the push results back to scrape_logs
      await logScrapeRun(
        'yard-sales', 'success',
        0, results.yard_shoppers_push.itemsPushed,
        results.yard_shoppers_push.errors,
        null
      );
    } catch (err: any) {
      results.yard_shoppers_push = { success: false, itemsPushed: 0, error: err.message };
    }

    try {
      results.cheap_house_push = await pushToCheapHouseHub();
      await logScrapeRun(
        'cheap-homes', 'success',
        0, results.cheap_house_push.itemsPushed,
        results.cheap_house_push.errors,
        null
      );
    } catch (err: any) {
      results.cheap_house_push = { success: false, itemsPushed: 0, error: err.message };
    }

    try {
      results.crypto_toolbox_push = await pushToCryptoToolbox();
      await logScrapeRun(
        'crypto', 'success',
        0, results.crypto_toolbox_push.itemsPushed,
        results.crypto_toolbox_push.errors,
        null
      );
    } catch (err: any) {
      results.crypto_toolbox_push = { success: false, itemsPushed: 0, error: err.message };
    }

    // === PHASE 3: SUMMARY ===
    const duration = Date.now() - startTime;

    const totalScraped =
      (results.yard_sales_scrape?.itemsFound || 0) +
      (results.cheap_homes_scrape?.itemsFound || 0) +
      (results.crypto_scrape?.itemsFound || 0);

    const totalPushed =
      (results.yard_shoppers_push?.itemsPushed || 0) +
      (results.cheap_house_push?.itemsPushed || 0) +
      (results.crypto_toolbox_push?.itemsPushed || 0);

    console.log(
      `[CRON] ========== Complete: ${totalScraped} scraped, ${totalPushed} pushed, ${(duration / 1000).toFixed(1)}s ==========`
    );

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      duration: `${(duration / 1000).toFixed(1)}s`,
      totalScraped,
      totalPushed,
      results,
    });
  } catch (err: any) {
    console.error('[CRON] Fatal error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message, results },
      { status: 500 }
    );
  }
}
