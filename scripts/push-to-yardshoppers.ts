import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SOURCE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SOURCE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEST_URL = process.env.YARDSHOPPERS_SUPABASE_URL || '';
const DEST_KEY = process.env.YARDSHOPPERS_SUPABASE_KEY || '';

console.log('');
console.log(' YARD SHOPPERS PUSH v5.0 — AUTO GEOCODE');
console.log(` Source (cityscraper): ${SOURCE_URL ? 'OK' : 'MISSING'}`);
console.log(` Destination (yardshoppers): ${DEST_URL ? 'OK' : 'MISSING'}`);
console.log('');

if (!SOURCE_URL || !SOURCE_KEY) { console.error('Missing cityscraper Supabase env vars'); process.exit(1); }
if (!DEST_URL || !DEST_KEY) { console.error('Missing YARDSHOPPERS_SUPABASE_URL or YARDSHOPPERS_SUPABASE_KEY'); process.exit(1); }

const source = createClient(SOURCE_URL, SOURCE_KEY);
const dest = createClient(DEST_URL, DEST_KEY);
const BATCH_SIZE = 200;
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const CACHE_FILE = path.resolve(process.cwd(), 'geo-cache.json');

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// 50 US state centroids — instant fallback when city lookup fails
const STATE_COORDS: Record<string, [number, number]> = {
  AL: [32.806671, -86.79113], AK: [61.370716, -152.404419], AZ: [33.729759, -111.431221],
  AR: [34.969704, -92.373123], CA: [36.116203, -119.681564], CO: [39.059811, -105.311104],
  CT: [41.597782, -72.755371], DE: [39.318523, -75.507141], FL: [27.766279, -81.686783],
  GA: [33.040619, -83.643074], HI: [21.094318, -157.498337], ID: [44.240459, -114.478828],
  IL: [40.349457, -88.986137], IN: [39.849426, -86.258278], IA: [42.011539, -93.210526],
  KS: [38.5266, -96.726486], KY: [37.66814, -84.670067], LA: [31.169546, -91.867805],
  ME: [44.693947, -69.381927], MD: [39.063946, -76.802101], MA: [42.230171, -71.530106],
  MI: [43.326618, -84.536095], MN: [45.694454, -93.900192], MS: [32.741646, -89.678696],
  MO: [38.456085, -92.288368], MT: [46.921925, -110.454353], NE: [41.12537, -98.268082],
  NV: [38.313515, -117.055374], NH: [43.452492, -71.563896], NJ: [40.298904, -74.521011],
  NM: [34.840515, -106.248482], NY: [42.165726, -74.948051], NC: [35.630066, -79.806419],
  ND: [47.528912, -99.784012], OH: [40.388783, -82.764915], OK: [35.565342, -96.928917],
  OR: [44.572021, -122.070938], PA: [40.590752, -77.209755], RI: [41.680893, -71.51178],
  SC: [33.856892, -80.945007], SD: [44.299782, -99.438828], TN: [35.747845, -86.692345],
  TX: [31.054487, -97.563461], UT: [40.150032, -111.862434], VT: [44.045876, -72.710686],
  VA: [37.769337, -78.169968], WA: [47.400902, -121.490494], WV: [38.491226, -80.954453],
  WI: [44.268543, -89.616508], WY: [42.755966, -107.30249], DC: [38.9072, -77.0369],
};

// Full state name to abbreviation
const STATE_ABBREV: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'district of columbia': 'DC',
};

function normalizeState(raw: string): string {
  const s = (raw || '').trim();
  if (s.length === 2) return s.toUpperCase();
  return STATE_ABBREV[s.toLowerCase()] || s.toUpperCase().substring(0, 2);
}

// Persistent geo-cache: loads from disk, saves back after each batch
let geoCache: Record<string, [number, number] | null> = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      geoCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      console.log(`Geo-cache loaded: ${Object.keys(geoCache).length} entries`);
    } else {
      console.log('No geo-cache found, starting fresh');
    }
  } catch { geoCache = {}; }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(geoCache), 'utf-8');
  } catch {}
}

async function geocodeCity(city: string, state: string): Promise<[number, number] | null> {
  const key = `${city.toLowerCase().trim()}|${state.toLowerCase().trim()}`;

  // Check cache first
  if (key in geoCache) return geoCache[key];

  // Call Nominatim
  try {
    const q = encodeURIComponent(`${city}, ${state}, United States`);
    const url = `${NOMINATIM}?q=${q}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'YardShoppers-Push/5.0 (contact@yardshoppers.com)' },
    });
    if (!res.ok) { geoCache[key] = null; return null; }
    const data = await res.json();
    if (data && data.length > 0) {
      const coords: [number, number] = [parseFloat(data[0].lat), parseFloat(data[0].lon)];
      geoCache[key] = coords;
      return coords;
    }
  } catch {}
  geoCache[key] = null;
  return null;
}

function getCoords(city: string, state: string): [number, number] | null {
  const key = `${city.toLowerCase().trim()}|${state.toLowerCase().trim()}`;
  if (key in geoCache && geoCache[key]) return geoCache[key];
  const abbrev = normalizeState(state);
  if (STATE_COORDS[abbrev]) return STATE_COORDS[abbrev];
  return null;
}

async function geocodeBatch(rows: any[]): Promise<void> {
  // Find unique city+state combos that aren't in cache yet
  const needed = new Map<string, { city: string; state: string }>();
  for (const r of rows) {
    const city = (r.city || '').trim();
    const state = (r.state || '').trim();
    if (!state) continue;
    const key = `${city.toLowerCase()}|${state.toLowerCase()}`;
    if (key in geoCache) continue;
    if (!needed.has(key)) needed.set(key, { city, state });
  }

  if (needed.size === 0) return;

  console.log(`  Geocoding ${needed.size} new city+state combos...`);
  let done = 0;
  for (const [, { city, state }] of needed) {
    const query = city ? `${city}, ${state}` : state;
    await geocodeCity(query, state);
    done++;
    await sleep(1100);
  }
  saveCache();
  console.log(`  Geocoded ${done} combos (cache now: ${Object.keys(geoCache).length} entries)`);
}

async function main() {
  loadCache();
  const now = new Date().toISOString();
  const today = now.split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  // CLEANUP
  console.log('STEP 1: CLEANUP\n');

  const { count: before } = await source.from('yard_sales').select('*', { count: 'exact', head: true });
  console.log(`  Cityscraper yard_sales: ${before}`);

  // Clean expired from cityscraper
  const { data: srcExp } = await source.from('yard_sales').delete()
    .lt('expires_at', now).not('expires_at', 'is', null).select('id');
  if (srcExp?.length) console.log(`  Removed ${srcExp.length} expired from cityscraper`);

  // Clean stale from cityscraper (no expiry, >14 days)
  const { data: srcStale } = await source.from('yard_sales').delete()
    .is('expires_at', null).lt('scraped_at', twoWeeksAgo).select('id');
  if (srcStale?.length) console.log(`  Removed ${srcStale.length} stale from cityscraper`);

  // Clean expired from yardshoppers
  const { data: destExp } = await dest.from('external_sales').delete()
    .lt('expires_at', now).not('expires_at', 'is', null).select('id');
  if (destExp?.length) console.log(`  Removed ${destExp.length} expired from yardshoppers`);

  // Clean ended from yardshoppers (sale_date < today)
  const { data: destEnded } = await dest.from('external_sales').delete()
    .lt('sale_date', today).not('sale_date', 'is', null).select('id');
  if (destEnded?.length) console.log(`  Removed ${destEnded.length} ended from yardshoppers`);

  // Clean stale from yardshoppers (no expiry, no sale_date, >14 days)
  const { data: destStale } = await dest.from('external_sales').delete()
    .is('expires_at', null).is('sale_date', null).lt('collected_at', twoWeeksAgo).select('id');
  if (destStale?.length) console.log(`  Removed ${destStale.length} stale from yardshoppers`);

  console.log('');

  // PUSH WITH AUTO-GEOCODE
  console.log('STEP 2: PUSH WITH AUTO-GEOCODE\n');

  const { count } = await source.from('yard_sales').select('*', { count: 'exact', head: true });
  const { count: destCount } = await dest.from('external_sales').select('*', { count: 'exact', head: true });
  console.log(`  Cityscraper ready to push: ${count}`);
  console.log(`  Yardshoppers current: ${destCount}\n`);

  if (!count || count === 0) { console.log('No sales to push.'); process.exit(0); }

  let totalPushed = 0;
  let totalSkipped = 0;
  let totalGeocoded = 0;
  let totalFallback = 0;
  let offset = 0;

  while (true) {
    const { data, error: fetchErr } = await source
      .from('yard_sales').select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('scraped_at', { ascending: false });

    if (fetchErr) { console.error(`Fetch error:`, fetchErr.message); break; }
    if (!data || data.length === 0) break;

    // Filter expired
    const fresh = data.filter((s: any) => {
      if (s.expires_at && new Date(s.expires_at) < new Date(now)) return false;
      return true;
    });
    const skipped = data.length - fresh.length;
    totalSkipped += skipped;

    if (fresh.length === 0) {
      if (data.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
      continue;
    }

    // Geocode any new city+state combos in this batch
    await geocodeBatch(fresh);

    // Map and apply coordinates
    const mapped = fresh.map((s: any) => {
      let lat = s.lat;
      let lng = s.lng;

      // If scraper didn't provide coords, use our lookup
      if (!lat || !lng) {
        const city = (s.city || '').trim();
        const state = (s.state || '').trim();
        const coords = getCoords(city, state);
        if (coords) {
          lat = coords[0];
          lng = coords[1];
          // Track if this was city-level or state fallback
          const key = `${city.toLowerCase()}|${state.toLowerCase()}`;
          if (key in geoCache && geoCache[key]) {
            totalGeocoded++;
          } else {
            totalFallback++;
          }
        }
      }

      return {
        source_id: s.source_id,
        source: s.source,
        title: s.title,
        description: s.description,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        latitude: lat,
        longitude: lng,
        sale_date: s.date_start,
        sale_time_start: s.time_start,
        sale_time_end: s.time_end,
        price: s.price_range,
        categories: s.categories,
        source_url: s.source_url,
        photo_urls: s.image_urls,
        expires_at: s.expires_at,
        collected_at: s.scraped_at,
      };
    });

    const { error: pushErr } = await dest
      .from('external_sales')
      .upsert(mapped, { onConflict: 'source_id', ignoreDuplicates: false });

    if (pushErr) { console.error(`Push error:`, pushErr.message); break; }

    totalPushed += fresh.length;
    process.stdout.write(`\r  Pushed ${totalPushed} listings...`);

    const ids = data.map((s: any) => s.source_id);
    await source.from('yard_sales').update({ pushed_at: new Date().toISOString() }).in('source_id', ids);

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  saveCache();

  const { count: newCount } = await dest.from('external_sales').select('*', { count: 'exact', head: true });

  console.log('\n');
  console.log(' PUSH COMPLETE');
  console.log(` Pushed: ${totalPushed}`);
  console.log(` Skipped (expired): ${totalSkipped}`);
  console.log(` City-geocoded: ${totalGeocoded}`);
  console.log(` State-fallback: ${totalFallback}`);
  console.log(` Geo-cache size: ${Object.keys(geoCache).length} cities`);
  console.log(` Yardshoppers before: ${destCount}`);
  console.log(` Yardshoppers after: ${newCount}`);
  console.log('');
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
