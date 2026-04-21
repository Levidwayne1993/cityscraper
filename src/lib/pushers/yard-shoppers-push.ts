import { supabaseAdmin, getYardShoppersClient } from '@/lib/supabase';

// ============================================================
//  YARD SHOPPERS PUSH MODULE v3 — DEFINITIVE FIELD MAP
//
//  v2 BUG: 9 field mismatches crashed the fetch query
//  (.order('collected_at') → column doesn't exist, it's 'scraped_at')
//
//  v3 FIX: Every field mapped from actual DB schemas:
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
    // 1. Fetch unpushed yard sales from CityScraper DB
    //    CRITICAL: order by 'scraped_at' — NOT 'collected_at'
    const { data: sales, error: fetchError } = await supabaseAdmin
      .from('yard_sales')
      .select('*')
      .eq('pushed', false)
      .order('scraped_at', { ascending: false })
      .limit(5000);


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
    //    Field names are REMAPPED from CityScraper → YardShoppers
    const ysClient = getYardShoppersClient();
    const batchSize = 100;

    for (let i = 0; i < sales.length; i += batchSize) {
      const batch = sales.slice(i, i + batchSize).map((sale) => ({
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
