import { supabaseAdmin, getYardShoppersClient } from '@/lib/supabase';
import axios from 'axios';

// ============================================================
//  YARD SHOPPERS PUSH MODULE
//  Pushes scraped yard sale data to YardShoppers.com
//  Supports: Direct Supabase insert OR API push
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
      .order('scraped_at', { ascending: false })
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

    // 2. Choose push method: Direct DB or API
    const useDirectDB = !!process.env.YARDSHOPPERS_SUPABASE_URL;
    const useAPI = !!process.env.YARDSHOPPERS_API_URL;

    if (useDirectDB) {
      // Direct Supabase insert to YardShoppers DB
      const ysClient = getYardShoppersClient();
      const batchSize = 100;

      for (let i = 0; i < sales.length; i += batchSize) {
        const batch = sales.slice(i, i + batchSize).map((sale) => ({
          external_id: sale.id,
          title: sale.title,
          description: sale.description,
          address: sale.address,
          city: sale.city,
          state: sale.state,
          zip: sale.zip,
          lat: sale.lat,
          lng: sale.lng,
          date_start: sale.date_start,
          date_end: sale.date_end,
          price_range: sale.price_range,
          categories: sale.categories,
          source: sale.source,
          source_url: sale.source_url,
          image_urls: sale.image_urls,
          imported_at: new Date().toISOString(),
          is_active: true,
        }));

        const { error: insertError } = await ysClient
          .from('listings')
          .upsert(batch, { onConflict: 'external_id' });

        if (insertError) {
          console.error('[Push:YardShoppers] Batch insert error:', insertError);
          errors++;
        } else {
          itemsPushed += batch.length;
        }
      }
    } else if (useAPI) {
      // API push to YardShoppers
      const apiUrl = process.env.YARDSHOPPERS_API_URL;
      const apiKey = process.env.YARDSHOPPERS_API_KEY;

      const batchSize = 50;
      for (let i = 0; i < sales.length; i += batchSize) {
        const batch = sales.slice(i, i + batchSize);

        try {
          const response = await axios.post(
            `${apiUrl}/import/yard-sales`,
            { items: batch },
            {
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey || '',
              },
              timeout: 30000,
            }
          );

          if (response.data?.success) {
            itemsPushed += batch.length;
          } else {
            errors++;
          }
        } catch (err: any) {
          console.error('[Push:YardShoppers] API push error:', err.message);
          errors++;
        }
      }
    } else {
      console.warn('[Push:YardShoppers] No push target configured');
      return { success: false, itemsPushed: 0, errors: 1 };
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
      }
    }
  } catch (err: any) {
    console.error('[Push:YardShoppers] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:YardShoppers] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}
