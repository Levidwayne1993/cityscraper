import { supabaseAdmin, getCheapHouseHubClient } from '@/lib/supabase';
import axios from 'axios';

// ============================================================
//  CHEAP HOUSE HUB PUSH MODULE
//  Pushes scraped home data to CheapHouseHub.com
// ============================================================

export async function pushToCheapHouseHub(): Promise<{
  success: boolean;
  itemsPushed: number;
  errors: number;
}> {
  console.log('[Push:CheapHouseHub] Starting push...');
  let itemsPushed = 0;
  let errors = 0;

  try {
    // 1. Fetch unpushed homes from CityScraper DB
    const { data: homes, error: fetchError } = await supabaseAdmin
      .from('cheap_homes')
      .select('*')
      .eq('pushed', false)
      .order('scraped_at', { ascending: false })
      .limit(500);

    if (fetchError) {
      console.error('[Push:CheapHouseHub] Fetch error:', fetchError);
      return { success: false, itemsPushed: 0, errors: 1 };
    }

    if (!homes || homes.length === 0) {
      console.log('[Push:CheapHouseHub] No new items to push');
      return { success: true, itemsPushed: 0, errors: 0 };
    }

    console.log(`[Push:CheapHouseHub] ${homes.length} items to push`);

    // 2. Push method selection
    const useDirectDB = !!process.env.CHEAPHOUSEHUB_SUPABASE_URL;
    const useAPI = !!process.env.CHEAPHOUSEHUB_API_URL;

    if (useDirectDB) {
      const chClient = getCheapHouseHubClient();
      const batchSize = 100;

      for (let i = 0; i < homes.length; i += batchSize) {
        const batch = homes.slice(i, i + batchSize).map((home) => ({
          external_id: home.id,
          title: home.title,
          address: home.address,
          city: home.city,
          state: home.state,
          zip: home.zip,
          price: home.price,
          original_price: home.original_price,
          bedrooms: home.bedrooms,
          bathrooms: home.bathrooms,
          sqft: home.sqft,
          lot_size: home.lot_size,
          property_type: home.property_type,
          listing_type: home.listing_type,
          source: home.source,
          source_url: home.source_url,
          image_urls: home.image_urls,
          lat: home.lat,
          lng: home.lng,
          imported_at: new Date().toISOString(),
          is_active: true,
        }));

        const { error: insertError } = await chClient
          .from('properties')
          .upsert(batch, { onConflict: 'external_id' });

        if (insertError) {
          console.error('[Push:CheapHouseHub] Batch insert error:', insertError);
          errors++;
        } else {
          itemsPushed += batch.length;
        }
      }
    } else if (useAPI) {
      const apiUrl = process.env.CHEAPHOUSEHUB_API_URL;
      const apiKey = process.env.CHEAPHOUSEHUB_API_KEY;

      const batchSize = 50;
      for (let i = 0; i < homes.length; i += batchSize) {
        const batch = homes.slice(i, i + batchSize);
        try {
          const response = await axios.post(
            `${apiUrl}/import/properties`,
            { items: batch },
            {
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
              timeout: 30000,
            }
          );
          if (response.data?.success) itemsPushed += batch.length;
          else errors++;
        } catch (err: any) {
          console.error('[Push:CheapHouseHub] API error:', err.message);
          errors++;
        }
      }
    } else {
      console.warn('[Push:CheapHouseHub] No push target configured');
      return { success: false, itemsPushed: 0, errors: 1 };
    }

    // 3. Mark as pushed
    if (itemsPushed > 0) {
      const pushedIds = homes.slice(0, itemsPushed).map((h) => h.id);
      await supabaseAdmin
        .from('cheap_homes')
        .update({ pushed: true, pushed_at: new Date().toISOString() })
        .in('id', pushedIds);
    }
  } catch (err: any) {
    console.error('[Push:CheapHouseHub] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:CheapHouseHub] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}
