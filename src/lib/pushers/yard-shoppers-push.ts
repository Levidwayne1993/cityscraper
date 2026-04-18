import { supabaseAdmin, getYardShoppersClient } from '@/lib/supabase';

// ============================================================
//  YARD SHOPPERS PUSH MODULE v2 — FIELD-MAPPED FIX
//
//  v1 BUG: Inserted into 'listings' with wrong field names
//  (lat, lng, date_start, image_urls, external_id, scraped_at)
//
//  v2 FIX: Inserts into 'external_sales' with correct fields
//  matching CityScraper yard_sales → YardShoppers external_sales
//
//  CRITICAL: includes expires_at — without it the YardShoppers
//  frontend filters out every listing (.gt('expires_at', now))
//
//  Field mapping (CityScraper → YardShoppers):
//    source_id    → source_id   (conflict key for upsert)
//    source       → source
//    latitude     → latitude
//    longitude    → longitude
//    sale_date    → sale_date
//    photo_urls   → photo_urls
//    price        → price
//    expires_at   → expires_at  (REQUIRED for frontend display)
//    collected_at → collected_at
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
    // 1. Fetch unpushed yard sales from CityScraper DB
    const { data: sales, error: fetchError } = await supabaseAdmin
      .from('yard_sales')
      .select('*')
      .eq('pushed', false)
      .order('collected_at', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('[Push:YardShoppers] Fetch error:', fetchError);
      return { success: false, itemsPushed: 0, errors: 1 };
    }

    if (!sales || sales.length === 0) {
      console.log('[Push:YardShoppers] No new items to push');
      return { success: true, itemsPushed: 0, errors: 0 };
    }

    console.log(`[Push:YardShoppers] ${sales.length} items to push`);

    // 2. Direct Supabase insert to YardShoppers external_sales table
    const ysClient = getYardShoppersClient();
    const batchSize = 100;

    for (let i = 0; i < sales.length; i += batchSize) {
      const batch = sales.slice(i, i + batchSize).map((sale) => ({
        source_id: sale.source_id,
        source: sale.source || 'cityscraper',
        title: sale.title,
        description: sale.description,
        address: sale.address,
        city: sale.city,
        state: sale.state,
        zip: sale.zip,
        latitude: sale.latitude,
        longitude: sale.longitude,
        price: sale.price,
        sale_date: sale.sale_date,
        sale_time_start: sale.sale_time_start,
        sale_time_end: sale.sale_time_end,
        category: sale.category,
        categories: sale.categories || [],
        photo_urls: sale.photo_urls || [],
        source_url: sale.source_url,
        expires_at: sale.expires_at || new Date(Date.now() + 14 * 86400000).toISOString(),
        collected_at: sale.collected_at || new Date().toISOString(),
      }));

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
  } catch (err: any) {
    console.error('[Push:YardShoppers] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:YardShoppers] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}
