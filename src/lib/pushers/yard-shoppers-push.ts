// ============================================================
// FIX 3: EXPIRY FILTERING — STOP PUSHING "SALE ENDED" LISTINGS
// FILE: src/lib/pushers/yard-shoppers-push.ts (CityScraper project)
//
// REPLACE the entire file with this version.
// Changes marked with "// FIX 3:" comments.
//
// WHAT THIS FIXES:
//   Before: Pusher sends ALL unpushed listings to YardShoppers,
//   including sales that happened days/weeks ago, flooding the
//   feed with "Sale Ended" badges.
//
//   After: Pusher filters out expired listings at TWO levels:
//     1. Supabase query level — skips rows where date_start
//        is more than 1 day in the past
//     2. JavaScript level — double-checks each row before mapping
//
//   Listings with NO date are still pushed (benefit of the doubt).
//   Listings happening TODAY are still pushed (sale may still be on).
//   Listings from YESTERDAY are still pushed (grace period).
//   Listings from 2+ days ago are skipped.
// ============================================================

import { supabaseAdmin, getYardShoppersClient } from '@/lib/supabase';

// ============================================================
//  YARD SHOPPERS PUSH MODULE v4 — WITH EXPIRY FILTERING
//
//  v3 → v4 CHANGES:
//    - Added expiry filter: won't push listings where the sale
//      date is more than 1 day in the past
//    - Added per-item expiry check as safety net
//    - Marks skipped expired items as pushed=true so they
//      don't clog the queue on future runs
//
//  CityScraper yard_sales    →  YardShoppers external_sales
//  ─────────────────────────────────────────────────────────
//  source_id                 →  source_id (conflict key)
//  source                    →  source
//  title                     →  title
//  description               →  description
//  address                   →  address
//  city                      →  city
//  state                     →  state
//  zip                       →  zip
//  lat                       →  latitude          ← RENAMED
//  lng                       →  longitude         ← RENAMED
//  price_range               →  price             ← RENAMED
//  date_start                →  sale_date          ← RENAMED
//  time_start                →  sale_time_start    ← RENAMED
//  time_end                  →  sale_time_end      ← RENAMED
//  categories[0]             →  category           ← DERIVED
//  categories                →  categories
//  image_urls                →  photo_urls         ← RENAMED
//  source_url                →  source_url
//  expires_at                →  expires_at
//  scraped_at                →  collected_at       ← RENAMED
// ============================================================

export async function pushToYardShoppers(): Promise<{
  success: boolean;
  itemsPushed: number;
  errors: number;
}> {
  console.log('[Push:YardShoppers] Starting push...');
  let itemsPushed = 0;
  let errors = 0;

  try {
    // FIX 3: Calculate the cutoff date — anything before this is "expired"
    // We use 1 day ago to give same-day and yesterday's sales a grace period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 1);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]; // "2026-04-23" format

    // 1. Fetch unpushed yard sales from CityScraper DB
    //    FIX 3: Added .or() filter — only fetch rows where:
    //      - date_start is NULL (no date known, give benefit of doubt), OR
    //      - date_start is >= cutoff (sale is today, tomorrow, or future)
    const { data: sales, error: fetchError } = await supabaseAdmin
      .from('yard_sales')
      .select('*')
      .eq('pushed', false)
      .or(`date_start.is.null,date_start.gte.${cutoffStr}`)
      .order('scraped_at', { ascending: false })
      .limit(5000);

    if (fetchError) {
      console.error('[Push:YardShoppers] Fetch error:', fetchError);
      return { success: false, itemsPushed: 0, errors: 1 };
    }

    if (!sales || sales.length === 0) {
      console.log('[Push:YardShoppers] No new items to push');

      // FIX 3: Mark any remaining expired unpushed items as pushed
      // so they don't clog the queue on future runs
      await markExpiredAsPushed(cutoffStr);

      return { success: true, itemsPushed: 0, errors: 0 };
    }

    console.log(`[Push:YardShoppers] ${sales.length} items to push`);

    // 2. Direct Supabase insert to YardShoppers external_sales table
    //    Field names are REMAPPED from CityScraper → YardShoppers
    const ysClient = getYardShoppersClient();
    const batchSize = 100;

    for (let i = 0; i < sales.length; i += batchSize) {
      const batch = sales.slice(i, i + batchSize)
        // FIX 3: Double-check expiry at JavaScript level (safety net)
        .filter((sale) => {
          if (!sale.date_start) return true; // No date = keep
          return sale.date_start >= cutoffStr;
        })
        .map((sale) => ({
          source_id:       sale.source_id,
          source:          sale.source || 'cityscraper',
          title:           sale.title,
          description:     sale.description,
          address:         sale.address,
          city:            sale.city,
          state:           sale.state,
          zip:             sale.zip,
          latitude:        sale.lat,              // yard_sales.lat → external_sales.latitude
          longitude:       sale.lng,              // yard_sales.lng → external_sales.longitude
          price:           sale.price_range,      // yard_sales.price_range → external_sales.price
          sale_date:       sale.date_start,       // yard_sales.date_start → external_sales.sale_date
          sale_time_start: sale.time_start,       // yard_sales.time_start → external_sales.sale_time_start
          sale_time_end:   sale.time_end,         // yard_sales.time_end → external_sales.sale_time_end
          category:        (sale.categories && sale.categories[0]) || 'Yard Sale',
          categories:      sale.categories || [],
          photo_urls:      sale.image_urls || [], // yard_sales.image_urls → external_sales.photo_urls
          source_url:      sale.source_url,
          expires_at:      sale.expires_at || new Date(Date.now() + 14 * 86400000).toISOString(),
          collected_at:    sale.scraped_at || new Date().toISOString(), // yard_sales.scraped_at → external_sales.collected_at
        }));

      if (batch.length === 0) continue; // FIX 3: Skip empty batches after filtering

      const { error: insertError } = await ysClient
        .from('external_sales')
        .upsert(batch, { onConflict: 'source,source_id' });

      if (insertError) {
        console.error('[Push:YardShoppers] Batch insert error:', insertError);
        errors++;
      } else {
        itemsPushed += batch.length;
        console.log(`[Push:YardShoppers] Pushed batch: ${itemsPushed}/${sales.length}`);
      }
    }

    // 3. Mark pushed items in CityScraper DB
    if (itemsPushed > 0) {
      const pushedIds = sales.slice(0, itemsPushed).map((s) => s.id);
      const { error: updateError } = await supabaseAdmin
        .from('yard_sales')
        .update({ pushed: true, pushed_at: new Date().toISOString() })
        .in('id', pushedIds);

      if (updateError) {
        console.error('[Push:YardShoppers] Mark pushed error:', updateError);
      } else {
        console.log(`[Push:YardShoppers] Marked ${pushedIds.length} items as pushed`);
      }
    }

    // FIX 3: Also mark any expired unpushed items so they stop showing up
    await markExpiredAsPushed(cutoffStr);

  } catch (err: any) {
    console.error('[Push:YardShoppers] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:YardShoppers] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}


// ============================================================
// FIX 3: Helper — marks expired unpushed items as pushed=true
// so they don't clog the fetch queue on every future cron run.
// These are sales where date_start < cutoff and pushed=false.
// We mark them pushed (even though we didn't push them) so the
// .eq('pushed', false) filter skips them next time.
// ============================================================
async function markExpiredAsPushed(cutoffStr: string): Promise<void> {
  try {
    const { data: expired, error: fetchErr } = await supabaseAdmin
      .from('yard_sales')
      .select('id')
      .eq('pushed', false)
      .not('date_start', 'is', null)
      .lt('date_start', cutoffStr)
      .limit(5000);

    if (fetchErr || !expired || expired.length === 0) return;

    const expiredIds = expired.map((e) => e.id);
    const { error: updateErr } = await supabaseAdmin
      .from('yard_sales')
      .update({ pushed: true, pushed_at: new Date().toISOString() })
      .in('id', expiredIds);

    if (!updateErr) {
      console.log(`[Push:YardShoppers] Marked ${expiredIds.length} expired items as pushed (skipped)`);
    }
  } catch (err: any) {
    console.error('[Push:YardShoppers] Error marking expired:', err.message);
  }
}
