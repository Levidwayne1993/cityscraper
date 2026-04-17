// ============================================================
// FILE: src/app/api/import/yard-sales/route.ts
// DEPLOY TO: YardShoppers.com repo (yardshoppers)
// STATUS: FIXED (v2) — Previous versions wrote to the WRONG
//         TABLE ('listings'). Your YardShoppers project uses:
//
//   listings       → user-created yard sales
//   external_sales → scraped/collected data from CityScraper
//
// This version writes to external_sales with the EXACT column
// names from your collector/src/db-client.ts and types.ts:
//   source, source_id, source_url, title, description,
//   city, state, latitude, longitude, price, sale_date,
//   sale_time_start, sale_time_end, category, categories,
//   photo_urls, address, zip, expires_at, collected_at
//
// PURPOSE: Receives pushed yard sale listings from CityScraper
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function validateImportKey(req: NextRequest): boolean {
  const apiKey =
    req.headers.get('x-api-key') ||
    req.headers.get('authorization')?.replace('Bearer ', '');
  return apiKey === process.env.IMPORT_API_KEY;
}

export async function POST(req: NextRequest) {
  if (!validateImportKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const items = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No items provided' },
        { status: 400 }
      );
    }

    // ============================================================
    // MAP CityScraper fields → external_sales REAL column names
    //
    // CityScraper sends:          external_sales expects:
    //   id                   →    (ignored, auto-generated UUID)
    //   source               →    source
    //   source_id / id       →    source_id        (UNIQUE key)
    //   source_url           →    source_url
    //   title                →    title
    //   description          →    description
    //   city                 →    city
    //   state                →    state
    //   lat                  →    latitude          ← REMAPPED
    //   lng                  →    longitude         ← REMAPPED
    //   price / price_range  →    price
    //   date_start           →    sale_date         ← REMAPPED
    //   date_end             →    sale_time_end     ← REMAPPED
    //   categories           →    categories
    //   category             →    category
    //   image_urls           →    photo_urls        ← REMAPPED
    //   address              →    address
    //   zip                  →    zip
    //   (computed)           →    expires_at
    //   (now)                →    collected_at
    // ============================================================

    const mapped = items.map((item: any) => ({
      // Identity & source
      source: item.source || 'cityscraper',
      source_id: item.source_id || item.id || `cs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source_url: item.source_url || '',

      // Content
      title: item.title || 'Untitled Sale',
      description: item.description || '',

      // Location — CityScraper uses lat/lng, YardShoppers uses latitude/longitude
      city: item.city || '',
      state: item.state || '',
      latitude: item.lat ?? item.latitude ?? null,
      longitude: item.lng ?? item.longitude ?? null,
      address: item.address || '',
      zip: item.zip || '',

      // Pricing
      price: item.price || item.price_range || '',

      // Dates — CityScraper uses date_start/date_end, YardShoppers uses sale_date/sale_time_end
      sale_date: item.sale_date || item.date_start || null,
      sale_time_start: item.sale_time_start || null,
      sale_time_end: item.sale_time_end || item.date_end || null,

      // Categories
      category: item.category || (Array.isArray(item.categories) && item.categories.length > 0 ? item.categories[0] : ''),
      categories: item.categories || [],

      // Images — CityScraper uses image_urls, YardShoppers uses photo_urls
      photo_urls: item.photo_urls || item.image_urls || [],

      // Timestamps
      expires_at: item.expires_at || null,
      collected_at: item.collected_at || new Date().toISOString(),
    }));

    // Batch upsert into external_sales (matches your db-client.ts pattern)
    const batchSize = 50; // Same batch size as your collector
    let totalInserted = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    for (let i = 0; i < mapped.length; i += batchSize) {
      const batch = mapped.slice(i, i + batchSize);
      const { error } = await supabase
        .from('external_sales')
        .upsert(batch, {
          onConflict: 'source_id',
          ignoreDuplicates: false, // Update existing records
        });

      if (error) {
        console.error(`[Import] Batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
        errors++;
        errorMessages.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
      } else {
        totalInserted += batch.length;
      }
    }

    console.log(`[Import] Yard sales: ${totalInserted}/${items.length} imported, ${errors} batch errors`);

    return NextResponse.json({
      success: errors === 0,
      imported: totalInserted,
      errors,
      errorMessages: errorMessages.length > 0 ? errorMessages : undefined,
      total: items.length,
    });
  } catch (err: any) {
    console.error('[Import] Fatal error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'import/yard-sales',
    status: 'ready',
    method: 'POST with { items: [...] }',
    target_table: 'external_sales',
    conflict_key: 'source_id',
    required_headers: 'x-api-key or Authorization: Bearer <key>',
    env_needed: 'IMPORT_API_KEY',
  });
}
