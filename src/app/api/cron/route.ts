// FILE: src/app/api/cron/route.ts
// REPLACES: src/app/api/cron/route.ts
// CLEANED: Removed cheap-homes and crypto scrape/push phases — yard-sales only

import { NextRequest, NextResponse } from 'next/server';
import { scrapeYardSales } from '@/lib/scrapers/yard-sale-scraper';
import { pushToYardShoppers } from '@/lib/pushers/yard-shoppers-push';
import { logScrapeRun } from '@/lib/supabase';

// ============================================================
// CRON HANDLER — Runs every 4 hours via Vercel Cron
// Sequence: Scrape Yard Sales → Push to YardShoppers → Log Results
// ============================================================

export const maxDuration = 300;

export async function GET(req: NextRequest) {
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
    // === PHASE 1: SCRAPE YARD SALES ===
    console.log('[CRON] Phase 1: Scraping yard sales...');

    try {
      results.yard_sales_scrape = await scrapeYardSales();
      await logScrapeRun(
        'yard-sales',
        'success',
        results.yard_sales_scrape.itemsFound,
        0,
        results.yard_sales_scrape.errors,
        null
      );
      console.log(
        `[CRON] Yard sales scrape: ${results.yard_sales_scrape.itemsFound} items`
      );
    } catch (err: any) {
      results.yard_sales_scrape = { success: false, itemsFound: 0, error: err.message };
      await logScrapeRun('yard-sales', 'error', 0, 0, 1, null, err.message);
      console.error('[CRON] Yard sales scrape failed:', err.message);
    }

    // === PHASE 2: PUSH TO YARDSHOPPERS ===
    console.log('[CRON] Phase 2: Pushing to YardShoppers...');

    try {
      results.yard_shoppers_push = await pushToYardShoppers();
      await logScrapeRun(
        'yard-sales',
        'success',
        0,
        results.yard_shoppers_push.itemsPushed,
        results.yard_shoppers_push.errors,
        null
      );
      console.log(
        `[CRON] YardShoppers push: ${results.yard_shoppers_push.itemsPushed} items`
      );
    } catch (err: any) {
      results.yard_shoppers_push = { success: false, itemsPushed: 0, error: err.message };
      console.error('[CRON] YardShoppers push failed:', err.message);
    }

    // === PHASE 3: SUMMARY ===
    const duration = Date.now() - startTime;
    const totalScraped = results.yard_sales_scrape?.itemsFound || 0;
    const totalPushed = results.yard_shoppers_push?.itemsPushed || 0;

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
