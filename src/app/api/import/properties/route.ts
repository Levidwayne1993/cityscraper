// ============================================================
// FILE: src/app/api/import/properties/route.ts
// DEPLOY TO: CheapHouseHub.com repo (cheaphousehub)
// STATUS: FIXED — original file 07 used external_id as the
//         upsert conflict key, but your ACTUAL properties table
//         uses source_url as the UNIQUE constraint.
//
// YOUR ACTUAL properties table columns:
//   id, title, address, city, state, zip, price, original_price,
//   bedrooms, bathrooms, sqft, lot_size, property_type,
//   listing_type, description, source, source_url (UNIQUE),
//   image_urls, lat, lng, savings_pct, scraped_at, created_at,
//   updated_at, imported_at*, is_active*, external_id*
//   (* = added by 10-cheaphousehub-schema-FIXED.txt)
//
// PURPOSE: Receives pushed property listings from CityScraper
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
    // MAP CityScraper fields → CheapHouseHub REAL column names
    //
    // Good news: Most column names MATCH between CityScraper and
    // CheapHouseHub. Only a few need remapping.
    //
    // CityScraper sends:          CheapHouseHub expects:
    //   id                   →    external_id (optional tracking)
    //   title                →    title
    //   address              →    address
    //   city                 →    city
    //   state                →    state
    //   zip                  →    zip
    //   price                →    price
    //   original_price       →    original_price
    //   bedrooms             →    bedrooms
    //   bathrooms            →    bathrooms
    //   sqft                 →    sqft
    //   lot_size             →    lot_size
    //   property_type        →    property_type
    //   listing_type         →    listing_type
    //   description          →    description          ← ADDED
    //   source               →    source
    //   source_url           →    source_url (UNIQUE)  ← CONFLICT KEY
    //   image_urls           →    image_urls           ← SAME NAME
    //   lat                  →    lat                  ← SAME NAME
    //   lng                  →    lng                  ← SAME NAME
    //   (computed)           →    savings_pct          ← COMPUTED
    //   (now)                →    imported_at
    //   (true)               →    is_active
    // ============================================================

    const mapped = items.map((item: any) => {
      // Compute savings percentage if we have both prices
      let savingsPct: number | null = null;
      if (item.original_price && item.price && item.original_price > item.price) {
        savingsPct = Math.round(
          ((item.original_price - item.price) / item.original_price) * 100
        );
      }

      return {
        // Identity
        external_id: item.id || item.external_id || null,
        source: item.source || 'cityscraper',
        source_url: item.source_url || '',

        // Property details
        title: item.title || 'Untitled Property',
        description: item.description || '',
        address: item.address || '',
        city: item.city || '',
        state: item.state || '',
        zip: item.zip || '',
        price: item.price || 0,
        original_price: item.original_price || null,
        bedrooms: item.bedrooms || null,
        bathrooms: item.bathrooms || null,
        sqft: item.sqft || null,
        lot_size: item.lot_size || null,
        property_type: item.property_type || 'single-family',
        listing_type: item.listing_type || 'cheap',

        // Media & location
        image_urls: item.image_urls || [],
        lat: item.lat || null,
        lng: item.lng || null,

        // Computed
        savings_pct: savingsPct,

        // Import metadata
        imported_at: new Date().toISOString(),
        scraped_at: item.scraped_at || new Date().toISOString(),
        is_active: true,
      };
    });

    // Filter out items with no source_url (can't upsert without it)
    const valid = mapped.filter((item) => item.source_url && item.source_url.length > 0);

    if (valid.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No items with valid source_url' },
        { status: 400 }
      );
    }

    // Batch upsert into properties table
    // CONFLICT KEY: source_url (your ACTUAL unique constraint)
    const batchSize = 100;
    let totalInserted = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < valid.length; i += batchSize) {
      const batch = valid.slice(i, i + batchSize);
      const { data, error } = await supabase
        .from('properties')
        .upsert(batch, { onConflict: 'source_url' });

      if (error) {
        console.error('[Import] Batch error:', error.message);
        errorDetails.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`);
        errors++;
      } else {
        totalInserted += batch.length;
      }
    }

    // Log the push
    await supabase.from('push_log').insert({
      source: 'cityscraper',
      properties_count: totalInserted,
      status: errors === 0 ? 'success' : 'partial',
      error_message: errorDetails.length > 0 ? errorDetails.join('; ') : null,
    });

    return NextResponse.json({
      success: errors === 0,
      imported: totalInserted,
      errors,
      total: items.length,
      skipped: items.length - valid.length,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });
    } catch (err) {
    console.error('[Import] Fatal error:', (err as Error).message);

    try {
      await supabase.from('push_log').insert({
        source: 'cityscraper',
        properties_count: 0,
        status: 'error',
        error_message: (err as Error).message,
      });
    } catch (_logErr) {
      // Silently ignore logging failure
    }

    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}


export async function GET() {
  return NextResponse.json({
    endpoint: 'import/properties',
    status: 'ready',
    method: 'POST to push property listings',
    headers: { 'x-api-key': 'required', 'Content-Type': 'application/json' },
    body: '{ "items": [{ title, address, city, state, zip, price, source_url, ... }] }',
    conflictKey: 'source_url',
    table: 'properties',
  });
}
