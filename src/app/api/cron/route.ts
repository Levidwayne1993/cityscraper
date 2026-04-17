import { NextRequest, NextResponse } from 'next/server';
import { scrapeYardSales } from '@/lib/scrapers/yard-sale-scraper';
import { scrapeCheapHomes } from '@/lib/scrapers/home-scraper';
import { scrapeCrypto } from '@/lib/scrapers/crypto-scraper';
import { pushToYardShoppers } from '@/lib/pushers/yard-shoppers-push';
import { pushToCheapHouseHub } from '@/lib/pushers/cheap-house-push';
import { pushToCryptoToolbox } from '@/lib/pushers/crypto-toolbox-push';
import { logScrapeRun } from '@/lib/supabase';

// ============================================================
//  CRON HANDLER — Runs every 4 hours via Vercel Cron
//  Sequence: Scrape All → Push All → Log Results
// ============================================================

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends this header)
  const cronSecret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (cronSecret !== process.env.CRON_SECRET) {
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
      console.log(`[CRON] Crypto scrape: ${results.crypto_scrape.itemsFound} items`);
    } catch (err: any) {
      results.crypto_scrape = { success: false, error: err.message };
      console.error('[CRON] Crypto scrape failed:', err.message);
    }

    // Yard sales
    try {
      results.yard_sales_scrape = await scrapeYardSales();
      console.log(`[CRON] Yard sales scrape: ${results.yard_sales_scrape.itemsFound} items`);
    } catch (err: any) {
      results.yard_sales_scrape = { success: false, error: err.message };
      console.error('[CRON] Yard sales scrape failed:', err.message);
    }

    // Cheap homes (slowest — multiple sources)
    try {
      results.cheap_homes_scrape = await scrapeCheapHomes();
      console.log(`[CRON] Cheap homes scrape: ${results.cheap_homes_scrape.itemsFound} items`);
    } catch (err: any) {
      results.cheap_homes_scrape = { success: false, error: err.message };
      console.error('[CRON] Cheap homes scrape failed:', err.message);
    }

    // === PHASE 2: PUSH TO TARGET SITES ===
    console.log('[CRON] Phase 2: Pushing to target sites...');

    try {
      results.yard_shoppers_push = await pushToYardShoppers();
    } catch (err: any) {
      results.yard_shoppers_push = { success: false, error: err.message };
    }

    try {
      results.cheap_house_push = await pushToCheapHouseHub();
    } catch (err: any) {
      results.cheap_house_push = { success: false, error: err.message };
    }

    try {
      results.crypto_toolbox_push = await pushToCryptoToolbox();
    } catch (err: any) {
      results.crypto_toolbox_push = { success: false, error: err.message };
    }

    // === PHASE 3: LOG RESULTS ===
    const duration = Date.now() - startTime;
    const totalScraped =
      (results.yard_sales_scrape?.itemsFound || 0) +
      (results.cheap_homes_scrape?.itemsFound || 0) +
      (results.crypto_scrape?.itemsFound || 0);
    const totalPushed =
      (results.yard_shoppers_push?.itemsPushed || 0) +
      (results.cheap_house_push?.itemsPushed || 0) +
      (results.crypto_toolbox_push?.itemsPushed || 0);

    console.log(`[CRON] ========== Complete: ${totalScraped} scraped, ${totalPushed} pushed, ${(duration / 1000).toFixed(1)}s ==========`);

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
