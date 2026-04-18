// ============================================================
// CREATE AS: src/app/api/geocode/route.ts (cityscraper project)
//
// Geocoding endpoint — geocodes external_sales in YardShoppers
// that are missing lat/lng coordinates.
//
// Groups by unique city+state so 344 listings from 50 cities
// = only 50 API calls (not 344).
//
// Also caches coords back to CityScraper's yard_sales table
// so future pushes automatically include coordinates.
//
// Uses OpenStreetMap Nominatim (free, no API key needed).
// Rate limited to 1 request/second per Nominatim policy.
//
// USAGE:
// $secret = (Get-Content .env.vercel | Select-String "CRON_SECRET").ToString().Split("=",2)[1]
// Invoke-WebRequest -Uri "https://www.cityscraper.org/api/geocode" -Headers @{authorization="Bearer $secret"} -TimeoutSec 120
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getYardShoppersClient } from '@/lib/supabase';

export const maxDuration = 60;

// ── Nominatim geocoder with in-memory cache ──
const cache = new Map<string, { lat: number; lng: number }>();

async function geocodeCity(
  city: string,
  state: string
): Promise<{ lat: number; lng: number } | null> {
  const key = `${city.toLowerCase().trim()},${state.toLowerCase().trim()}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q: `${city}, ${state}, USA`,
      format: 'json',
      countrycodes: 'us',
      limit: '1',
    })}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'CityScraper/1.0 (yard-sale-aggregator)' },
    });

    if (!res.ok) return null;
    const data = await res.json();

    if (data.length > 0) {
      const result = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
      cache.set(key, result);
      return result;
    }
    return null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function GET(req: NextRequest) {
  // ── Auth ──
  const secret =
    req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.headers.get('x-api-key') ||
    '';
  const validSecret = process.env.CRON_SECRET || '';
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Geocode] ========== Starting geocode phase ==========');
  const startTime = Date.now();
  const ysClient = getYardShoppersClient();
  let citiesGeocoded = 0;
  let listingsUpdated = 0;
  let failed = 0;

  try {
    // 1. Fetch external_sales from YardShoppers where latitude IS NULL
    const { data: nullRows, error: fetchErr } = await ysClient
      .from('external_sales')
      .select('id, city, state')
      .is('latitude', null)
      .limit(1000);

    if (fetchErr) {
      console.error('[Geocode] Fetch error:', fetchErr.message);
      return NextResponse.json({
        success: false,
        error: fetchErr.message,
        citiesGeocoded: 0,
        listingsUpdated: 0,
      });
    }

    if (!nullRows || nullRows.length === 0) {
      console.log('[Geocode] All listings already have coordinates');
      return NextResponse.json({
        success: true,
        message: 'All listings already geocoded',
        citiesGeocoded: 0,
        listingsUpdated: 0,
      });
    }

    // 2. Group by unique city+state
    const cityStateMap = new Map<
      string,
      { city: string; state: string; ids: string[] }
    >();

    for (const row of nullRows) {
      if (!row.city || !row.state) continue;
      const key = `${row.city.toLowerCase().trim()}|${row.state.toLowerCase().trim()}`;
      if (!cityStateMap.has(key)) {
        cityStateMap.set(key, { city: row.city, state: row.state, ids: [] });
      }
      cityStateMap.get(key)!.ids.push(row.id);
    }

    console.log(
      `[Geocode] ${nullRows.length} listings missing coords across ${cityStateMap.size} unique cities`
    );

    // 3. Geocode each unique city+state via Nominatim
    for (const [key, entry] of Array.from(cityStateMap.entries())) {
      // Safety: stop if approaching Vercel timeout (leave 8s buffer)
      if (Date.now() - startTime > 52000) {
        console.log('[Geocode] Approaching timeout, stopping. Run again to continue.');
        break;
      }

      const coords = await geocodeCity(entry.city, entry.state);

      if (!coords) {
        console.log(`[Geocode] Failed to geocode: ${entry.city}, ${entry.state}`);
        failed++;
        await sleep(1100); // Still respect rate limit
        continue;
      }

      citiesGeocoded++;

      // 4. Update YardShoppers external_sales — set lat/lng for all rows in this city
      const { error: ysUpdateErr, count } = await ysClient
        .from('external_sales')
        .update({ latitude: coords.lat, longitude: coords.lng })
        .in('id', entry.ids);

      if (ysUpdateErr) {
        console.error(
          `[Geocode] YS update error for ${entry.city}, ${entry.state}:`,
          ysUpdateErr.message
        );
      } else {
        listingsUpdated += entry.ids.length;
        console.log(
          `[Geocode] ${entry.city}, ${entry.state} → ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)} (${entry.ids.length} listings)`
        );
      }

      // 5. Also cache coords in CityScraper's yard_sales for future pushes
      await supabaseAdmin
        .from('yard_sales')
        .update({ lat: coords.lat, lng: coords.lng })
        .ilike('city', entry.city)
        .ilike('state', entry.state)
        .is('lat', null);

      // Nominatim rate limit: max 1 request per second
      await sleep(1100);
    }
  } catch (err: any) {
    console.error('[Geocode] Fatal error:', err.message);
    return NextResponse.json({
      success: false,
      error: err.message,
      citiesGeocoded,
      listingsUpdated,
      failed,
    });
  }

  const duration = Date.now() - startTime;
  console.log(
    `[Geocode] Complete: ${citiesGeocoded} cities geocoded, ${listingsUpdated} listings updated, ${failed} failed in ${(duration / 1000).toFixed(1)}s`
  );

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    duration: `${(duration / 1000).toFixed(1)}s`,
    citiesGeocoded,
    listingsUpdated,
    failed,
    note:
      listingsUpdated < (citiesGeocoded + failed) * 10
        ? undefined
        : 'Run again if listings remain — Nominatim rate limit allows ~45 cities per call',
  });
}
