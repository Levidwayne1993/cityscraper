// ============================================================
//  FILE: src/lib/pushers/cheap-house-push.ts  (REPLACES EXISTING)
//  CHEAP HOUSE HUB PUSH MODULE v2.0
//  Pushes scraped home data to CheapHouseHub.com
//
//  UPDATED: Maps ALL v2 fields including county, starting_bid,
//  assessed_value, year_built, listing_category, description,
//  auction_date, case_number, parcel_id, property_status
// ============================================================

import { supabaseAdmin, getCheapHouseHubClient } from '@/lib/supabase';
import axios from 'axios';

// ============================================================
//  FIELD MAPPER — Maps CityScraper cheap_homes → CheapHouseHub properties
//  Central place to adjust field names if schemas differ
// ============================================================

function mapHomeToProperty(home: any) {
  return {
    // Identity
    external_id: home.id,

    // Address
    title: home.title,
    address: home.address,
    city: home.city,
    state: home.state,
    zip: home.zip,
    county: home.county || null,

    // Pricing
    price: home.price,
    original_price: home.original_price || null,
    starting_bid: home.starting_bid || null,
    assessed_value: home.assessed_value || null,

    // Property details
    bedrooms: home.bedrooms,
    bathrooms: home.bathrooms,
    sqft: home.sqft,
    lot_size: home.lot_size || null,
    year_built: home.year_built || null,

    // Classification
    property_type: home.property_type || 'single-family',
    listing_type: home.listing_type || 'cheap',
    listing_category: home.listing_category || 'other',

    // Source tracking
    source: home.source,
    source_url: home.source_url,
    image_urls: home.image_urls || [],
    description: home.description || null,

    // Auction / legal info
    auction_date: home.auction_date || null,
    case_number: home.case_number || null,
    parcel_id: home.parcel_id || null,
    property_status: home.property_status || 'active',

    // Geolocation
    lat: home.lat,
    lng: home.lng,

    // System
    imported_at: new Date().toISOString(),
    is_active: true,
  };
}

// ============================================================
//  MAIN PUSH FUNCTION
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
      // --- DIRECT SUPABASE PUSH ---
      const chClient = getCheapHouseHubClient();
      const batchSize = 100;

      for (let i = 0; i < homes.length; i += batchSize) {
        const batch = homes.slice(i, i + batchSize).map(mapHomeToProperty);

        const { error: insertError } = await chClient
          .from('properties')
          .upsert(batch, { onConflict: 'external_id' });

        if (insertError) {
          console.error(`[Push:CheapHouseHub] Batch ${Math.floor(i / batchSize) + 1} insert error:`, insertError);
          errors++;
        } else {
          itemsPushed += batch.length;
          console.log(`[Push:CheapHouseHub] Batch ${Math.floor(i / batchSize) + 1}: ${batch.length} items pushed`);
        }
      }
    } else if (useAPI) {
      // --- API PUSH ---
      const apiUrl = process.env.CHEAPHOUSEHUB_API_URL;
      const apiKey = process.env.CHEAPHOUSEHUB_API_KEY;

      const batchSize = 50;
      for (let i = 0; i < homes.length; i += batchSize) {
        const batch = homes.slice(i, i + batchSize).map(mapHomeToProperty);
        try {
          const response = await axios.post(
            `${apiUrl}/import/properties`,
            { items: batch },
            {
              headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' },
              timeout: 30000,
            }
          );
          if (response.data?.success) {
            itemsPushed += batch.length;
            console.log(`[Push:CheapHouseHub] API batch ${Math.floor(i / batchSize) + 1}: ${batch.length} items pushed`);
          } else {
            console.error(`[Push:CheapHouseHub] API batch ${Math.floor(i / batchSize) + 1} failed:`, response.data);
            errors++;
          }
        } catch (err: any) {
          console.error('[Push:CheapHouseHub] API error:', err.message);
          errors++;
        }
      }
    } else {
      console.warn('[Push:CheapHouseHub] No push target configured (set CHEAPHOUSEHUB_SUPABASE_URL or CHEAPHOUSEHUB_API_URL)');
      return { success: false, itemsPushed: 0, errors: 1 };
    }

    // 3. Mark as pushed in CityScraper DB
    if (itemsPushed > 0) {
      const pushedIds = homes.slice(0, itemsPushed).map((h: any) => h.id);

      // Batch the update in chunks to avoid hitting Supabase limits
      const updateBatchSize = 200;
      for (let i = 0; i < pushedIds.length; i += updateBatchSize) {
        const idBatch = pushedIds.slice(i, i + updateBatchSize);
        const { error: updateError } = await supabaseAdmin
          .from('cheap_homes')
          .update({ pushed: true, pushed_at: new Date().toISOString() })
          .in('id', idBatch);

        if (updateError) {
          console.error('[Push:CheapHouseHub] Mark-pushed error:', updateError);
        }
      }
    }
  } catch (err: any) {
    console.error('[Push:CheapHouseHub] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:CheapHouseHub] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}
