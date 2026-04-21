// ============================================================
// FILE: scripts/geocode-backfill.ts (CityScraper project)
// CREATE this NEW file in: scripts/geocode-backfill.ts
//
// GEOCODE BACKFILL SCRIPT
// Finds all yard_sales rows with lat=null or lng=null,
// geocodes them using free Nominatim (OpenStreetMap),
// and updates the rows in Supabase.
//
// RUN: npx tsx scripts/geocode-backfill.ts
//
// Rate limit: 1 request per second (Nominatim policy).
// For 500 rows, this takes ~8-9 minutes.
//
// ENV VARS REQUIRED (in .env.local):
//   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
//   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//
// NO NEW INSTALLS NEEDED — uses built-in fetch + existing deps
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE env vars. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── CONFIG ──
const BATCH_SIZE = 100;          // how many rows to fetch at a time
const MAX_TOTAL = 2000;          // safety cap — max rows to process per run
const DELAY_MS = 1100;           // 1.1 seconds between requests (Nominatim = 1 req/sec)
const USER_AGENT = 'CityScraper/2.0 (cityscraper.org)';

// ── GEOCODE ONE ADDRESS ──
async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zip: string
): Promise<{ lat: number; lng: number } | null> {
  // Build the best query we can
  const parts: string[] = [];
  if (address) parts.push(address);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);

  const query = parts.join(', ');
  if (!query.trim()) return null;

  const url = `https://nominatim.openstreetmap.org/search?` +
    `q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) {
      console.warn(`  ⚠️  Nominatim returned ${response.status} for: ${query}`);
      return null;
    }

    const results = await response.json();
    if (results && results.length > 0) {
      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }

    return null;
  } catch (err) {
    console.warn(`  ⚠️  Geocode error for "${query}":`, (err as Error).message);
    return null;
  }
}

// ── SLEEP HELPER ──
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── MAIN ──
async function main() {
  console.log('='.repeat(60));
  console.log('  GEOCODE BACKFILL — CityScraper');
  console.log('  Filling in lat/lng for yard_sales rows');
  console.log('='.repeat(60));
  console.log('');

  let totalProcessed = 0;
  let totalGeocoded = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let hasMore = true;

  while (hasMore && totalProcessed < MAX_TOTAL) {
    // Fetch a batch of rows with null lat or lng
    const { data: rows, error } = await supabase
      .from('yard_sales')
      .select('id, address, city, state, zip, lat, lng')
      .or('lat.is.null,lng.is.null')
      .limit(BATCH_SIZE);

    if (error) {
      console.error('❌ Supabase query error:', error.message);
      break;
    }

    if (!rows || rows.length === 0) {
      console.log('✅ No more rows need geocoding!');
      hasMore = false;
      break;
    }

    console.log(`📦 Fetched batch of ${rows.length} rows to geocode...`);

    for (const row of rows) {
      totalProcessed++;

      // Skip if no address info at all
      if (!row.address && !row.city && !row.state) {
        totalSkipped++;
        continue;
      }

      // Geocode
      const coords = await geocodeAddress(
        row.address || '',
        row.city || '',
        row.state || '',
        row.zip || ''
      );

      if (coords) {
        // Update the row
        const { error: updateError } = await supabase
          .from('yard_sales')
          .update({ lat: coords.lat, lng: coords.lng })
          .eq('id', row.id);

        if (updateError) {
          console.warn(`  ⚠️  Failed to update row ${row.id}: ${updateError.message}`);
          totalFailed++;
        } else {
          totalGeocoded++;
          if (totalGeocoded % 25 === 0) {
            console.log(`  ✅ Geocoded ${totalGeocoded} so far...`);
          }
        }
      } else {
        totalFailed++;
      }

      // Rate limit — 1 request per second
      await sleep(DELAY_MS);
    }

    // If we got a full batch, there might be more
    hasMore = rows.length === BATCH_SIZE;
  }

  // ── SUMMARY ──
  console.log('');
  console.log('='.repeat(60));
  console.log('  GEOCODE BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Processed:  ${totalProcessed}`);
  console.log(`  Geocoded:   ${totalGeocoded}`);
  console.log(`  Failed:     ${totalFailed}`);
  console.log(`  Skipped:    ${totalSkipped} (no address data)`);
  console.log('='.repeat(60));

  // Also update the yardshoppers side if there's a push after this
  console.log('');
  console.log('💡 TIP: Run the push after this to send geocoded data to YardShoppers:');
  console.log('   npx tsx scripts/push-all.ts');
  console.log('   OR trigger the push from your cityscraper dashboard');
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
