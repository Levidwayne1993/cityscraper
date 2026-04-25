// ============================================================
// FILE: scripts/crawlee-deep-scraper.ts (CityScraper project)
// REPLACES: scripts/crawlee-deep-scraper.ts
//
// CRAWLEE DEEP SCRAPER v4.0 — CLEAN DESCRIPTIONS + TIME FIX + ALL v3.8 FEATURES
//
// v4.0 CHANGES:
//   1. FIX: CL detail selector — cascading fallback instead of comma-join
//      (was grabbing ALL page chrome: nav arrows, buttons, metadata, etc.)
//   2. NEW: cleanDescription() — strips CL/source junk (nav, buttons, metadata,
//      QR text, scam warnings, post IDs, best-of, flag icons, etc.)
//   3. FIX: normalizeTime() — ensures "8 AM" becomes "8:00 AM" (fixes
//      "8undefined AM" display bug on YardShoppers frontend)
//   4. cleanDescription() applied on ALL detail handlers (CL, ES, GSF, YSS, Gsalr)
//
// ALL PREVIOUS FEATURES PRESERVED:
//   - 413 CL subdomains with /gms + /sss (keyword+address gates)
//   - CL estate+sale & moving+sale sub-queries
//   - 274 YardSaleSearch cities × 5 pages
//   - 50 EstateSales.net states × 5 pages
//   - 50 GarageSaleFinder states × 5 pages
//   - 50 Gsalr.com states × 3 pages (ScraperAPI-only)
//   - Photo-fix helpers (v3.1): getImgUrl, getAllImgUrls, parseCraigslistDataIds
//   - Save-first (v3.8) + post-crawl address cleanup + post-crawl geocoding
//   - 50+ keyword filter with typo support (v3.6)
//   - Strict address validation (v3.5)
//   - Detail page crawling on all sources
//   - Deduplication via seenIds Set + Supabase upsert on source_url
//
// RUN: npx tsx scripts/crawlee-deep-scraper.ts
//
// ENV VARS REQUIRED (in .env.local):
//   SCRAPER_API_KEY=your_key_here
//   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
//   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//
// INSTALL:
//   npm install crawlee cheerio dotenv @supabase/supabase-js
// ============================================================

import { CheerioCrawler, ProxyConfiguration, log, purgeDefaultStorages } from 'crawlee';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// ── CONFIG ──
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE env vars. Check .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── GEOCODING CONFIG ──
const GEOCODE_DELAY_MS = 1100;
const GEOCODE_USER_AGENT = 'CityScraper/4.0 (cityscraper.org)';

// ── PAGINATION LIMITS ──
const CL_MAX_PAGES = 3;
const ES_MAX_PAGES = 5;
const GSF_MAX_PAGES = 5;
const YSS_MAX_PAGES = 5;

// ── SAVE BATCHES ──
const SAVE_BATCH_SIZE = 25;

// ── TYPES ──
interface ScrapedSale {
  source_id: string;
  title: string;
  description: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  date_start: string;
  date_end: string | null;
  time_start: string | null;
  time_end: string | null;
  price_range: string | null;
  categories: string[];
  source: string;
  source_url: string;
  image_urls: string[];
  expires_at: string;
  scraped_at: string;
  pushed: boolean;
}

// ── PER-SOURCE COUNTERS ──
const sourceStats: Record<string, { success: number; failed: number; listings: number }> = {
  craigslist: { success: 0, failed: 0, listings: 0 },
  estatesales: { success: 0, failed: 0, listings: 0 },
  garagesalefinder: { success: 0, failed: 0, listings: 0 },
  yardsalesearch: { success: 0, failed: 0, listings: 0 },
  gsalr: { success: 0, failed: 0, listings: 0 },
};

// ── ADDRESS VALIDATION (hard gate) ──
function hasValidAddress(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return false;
  return /^\d+\s+[\w]+(\s+[\w]+)*\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Trail|Tr|Terrace|Trl|Loop|Run|Pass|Pike|Alley|Aly)\b/i.test(t);
}

// ── YARD SALE KEYWORD FILTER (v3.6: 50+ terms with misspelling support) ──
const SALE_TERMS = [
  'yard[-\\s]*s[ae]i?le?s?',
  'yrad[-\\s]*s[ae]i?le?s?',
  'g[ae]?r[ae]?ge?[-\\s]*s[ae]i?le?s?',
  'est[ae]te?[-\\s]*s[ae]i?le?s?',
  'mov[ei]*n[g\']?[-\\s]*(out[-\\s]*)?s[ae]i?le?s?',
  'r[uo]mm?[aei]ge[-\\s]*s[ae]i?le?s?',
  'tag[-\\s]*s[ae]i?le?s?',
  'porch[-\\s]*s[ae]i?le?s?',
  'car[-\\s]*port[-\\s]*s[ae]i?le?s?',
  'drive[-\\s]*way[-\\s]*s[ae]i?le?s?',
  'barn[-\\s]*s[ae]i?le?s?',
  'shed[-\\s]*s[ae]i?le?s?',
  'storage[-\\s]*s[ae]i?le?s?',
  'downsiz\\w*[-\\s]*s[ae]i?le?s?',
  'downsiz\\w*',
  'clean[-\\s]*out[-\\s]*s[ae]i?le?s?',
  'house[-\\s]*clean[-\\s]*out',
  'whole[-\\s]*house[-\\s]*s[ae]i?le?s?',
  'everything[-\\s]*must[-\\s]*go',
  'liquidat\\w*[-\\s]*s[ae]i?le?s?',
  'household[-\\s]*(s[ae]i?le?s?|goods)',
  'multi[-\\s]*family[-\\s]*s[ae]i?le?s?',
  'family[-\\s]*s[ae]i?le?s?',
  'community[-\\s]*s[ae]i?le?s?',
  'n[ei]+gh?b[ou]*r[-\\s]*h?oo?d[-\\s]*s[ae]i?le?s?',
  'sub[-\\s]*divi[sz]i?on[-\\s]*s[ae]i?le?s?',
  'block[-\\s]*s[ae]i?le?s?',
  'street[-\\s]*s[ae]i?le?s?',
  'hoa[-\\s]*s[ae]i?le?s?',
  'church[-\\s]*s[ae]i?le?s?',
  'fundrais\\w*[-\\s]*s[ae]i?le?s?',
  'school[-\\s]*r[uo]mm?age',
  'fl[ei]+a?[-\\s]*mar[ck][ei]t',
  'swap[-\\s]*meets?',
  'relocat\\w*[-\\s]*s[ae]i?le?s?',
  'pre[-\\s]*move[-\\s]*s[ae]i?le?s?',
  'going[-\\s]*away[-\\s]*s[ae]i?le?s?',
  'leaving[-\\s]*town',
  'pop[-\\s]*up[-\\s]*s[ae]i?le?s?',
  'tool[-\\s]*s[ae]i?le?s?',
  'antique[-\\s]*s[ae]i?le?s?',
  'online[-\\s]*(yard|garage)[-\\s]*s[ae]i?le?s?',
  'local[-\\s]*yard[-\\s]*s[ae]i?le?s?',
  '(yard|garage)[-\\s]*s[ae]i?le?s?[-\\s]*near[-\\s]*me',
  'declutter\\w*',
].join('|');
const SALE_KEYWORDS = new RegExp(`\\b(${SALE_TERMS})\\b`, 'i');
function isYardSale(title: string, description?: string): boolean {
  return SALE_KEYWORDS.test(title) || SALE_KEYWORDS.test(description || '');
}

function extractAddressFromText(text: string): string | null {
  const match = text.match(/(\d+\s+[A-Za-z][\w\s]*(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Trail|Tr|Terrace|Trl)[^,]*(?:,\s*[A-Za-z\s]+)?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?)/i);
  return match ? match[1].trim() : null;
}

// ── ZIP CODE EXTRACTION ──
function extractZip(text: string): string {
  const match = text.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : '';
}

// ── v4.0 NEW: TIME NORMALIZATION ──
// Ensures all times have minutes: "8 AM" → "8:00 AM", "8AM" → "8:00 AM"
// Fixes the "8undefined AM" bug on YardShoppers frontend
function normalizeTime(t: string): string {
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!m) return t;
  const hours = m[1];
  const minutes = m[2] || '00';
  const period = m[3].toUpperCase();
  return `${hours}:${minutes} ${period}`;
}

// ── TIME EXTRACTION (v4.0: now normalizes all times) ──
function extractTimes(text: string): { time_start: string | null; time_end: string | null } {
  const rangeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
  if (rangeMatch) {
    return {
      time_start: normalizeTime(rangeMatch[1].trim()),
      time_end: normalizeTime(rangeMatch[2].trim()),
    };
  }
  const singleMatch = text.match(/(?:starts?\s+(?:at\s+)?|opens?\s+(?:at\s+)?|from\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
  if (singleMatch) {
    return { time_start: normalizeTime(singleMatch[1].trim()), time_end: null };
  }
  return { time_start: null, time_end: null };
}

// ── DATE EXTRACTION FROM TEXT ──
function extractDateFromText(text: string): string | null {
  const fullMatch = text.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
  if (fullMatch) {
    const d = new Date(fullMatch[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  const slashMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (slashMatch) {
    const d = new Date(slashMatch[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  return null;
}

// ── UNIVERSAL IMAGE EXTRACTION (v3.1 photo-fix) ──
function getImgUrl(el: any, $: any): string {
  const img = $(el).is('img') ? $(el) : $(el).find('img').first();
  return (
    img.attr('src') ||
    img.attr('data-src') ||
    img.attr('data-lazy') ||
    img.attr('data-lazy-src') ||
    img.attr('data-original') ||
    img.attr('data-image') ||
    img.attr('content') ||
    img.attr('srcset')?.split(',')[0]?.trim()?.split(' ')[0] ||
    ''
  );
}

function getAllImgUrls(container: any, $: any): string[] {
  const urls: string[] = [];
  $(container).find('img').each((_: number, img: any) => {
    const src =
      $(img).attr('src') ||
      $(img).attr('data-src') ||
      $(img).attr('data-lazy') ||
      $(img).attr('data-lazy-src') ||
      $(img).attr('data-original') ||
      $(img).attr('data-image') ||
      '';
    if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('spacer') && !src.includes('pixel') && src.length > 10) {
      urls.push(src);
    }
  });
  return urls;
}

function parseCraigslistDataIds($: any): string[] {
  const urls: string[] = [];
  $('[data-ids]').each((_: number, el: any) => {
    const dataIds = $(el).attr('data-ids') || '';
    const ids = dataIds.split(',').map((id: string) => id.replace(/^\d+:/, '').trim());
    for (const id of ids) {
      if (id && id.length > 3) {
        urls.push(`https://images.craigslist.org/${id}_600x450.jpg`);
      }
    }
  });
  return urls;
}

// ── CATEGORY DETECTION ──
function guessCategories(text: string): string[] {
  const lower = text.toLowerCase();
  const cats: string[] = [];
  if (/estate\s*sale/i.test(lower)) cats.push('Estate Sale');
  if (/garage\s*sale/i.test(lower)) cats.push('Garage Sale');
  if (/yard\s*sale/i.test(lower)) cats.push('Yard Sale');
  if (/moving\s*sale/i.test(lower)) cats.push('Moving Sale');
  if (/multi[-\s]?family/i.test(lower)) cats.push('Multi-Family Sale');
  if (/church|charity|fundraiser/i.test(lower)) cats.push('Charity Sale');
  if (/rummage/i.test(lower)) cats.push('Rummage Sale');
  if (/barn\s*sale/i.test(lower)) cats.push('Barn Sale');
  if (/flea\s*market/i.test(lower)) cats.push('Flea Market');
  if (cats.length === 0) cats.push('Garage Sale');
  return cats;
}

// ══════════════════════════════════════════════════════════════
// v4.0 NEW: DESCRIPTION CLEANING
// Strips Craigslist page chrome and other source junk from
// descriptions before saving to Supabase.
// ══════════════════════════════════════════════════════════════
function cleanDescription(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // ── Craigslist navigation arrows & surrounding whitespace ──
  text = text.replace(/◀\s*prev/gi, '');
  text = text.replace(/next\s*▶/gi, '');
  text = text.replace(/[◀▶▲▼]/g, '');

  // ── CL action buttons ──
  text = text.replace(/\b(reply|favorite|hide|unhide|flag|flagged)\b/gi, '');

  // ── CL flag icons ──
  text = text.replace(/[⚐⚑]/g, '');

  // ── "Posted YYYY-MM-DD HH:MM" metadata line ──
  text = text.replace(/Posted\s+\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/gi, '');

  // ── "Contact Information: print" ──
  text = text.replace(/Contact\s+Information:\s*print/gi, '');

  // ── "QR Code Link to This Post" ──
  text = text.replace(/QR\s+Code\s+Link\s+to\s+This\s+Post/gi, '');

  // ── "♥ best of [?]" ──
  text = text.replace(/♥\s*best\s+of\s*\[\?\]/gi, '');
  text = text.replace(/♥/g, '');

  // ── CL post footer: "post id: 1234567890" ──
  text = text.replace(/post\s+id:\s*\d+/gi, '');

  // ── CL footer timestamps: "posted: 2026-03-11 15:16" / "updated: ..." ──
  text = text.replace(/(?:posted|updated):\s*\d{4}-\d{2}-\d{2}\s*\d{1,2}:\d{2}/gi, '');

  // ── Standalone "posted:" or "updated:" leftover ──
  text = text.replace(/\b(?:posted|updated):\s*/gi, '');

  // ── CL scam warning block ──
  text = text.replace(/Avoid\s+scams,?\s+deal\s+locally[\s\S]*?shipping\./gi, '');
  text = text.replace(/Beware\s+wiring\s*\(e\.?g\.?\s*Western\s+Union\)[\s\S]*?shipping\./gi, '');

  // ── CL "do NOT contact me with unsolicited..." ──
  text = text.replace(/do\s+NOT\s+contact\s+me\s+with\s+unsolicited[\s\S]*?(?:services|offers)\s*\.?/gi, '');

  // ── CL dates/start time labels (the structured ones, not the user content) ──
  text = text.replace(/\bdates:\s*/gi, '');
  text = text.replace(/\bstart\s+time:\s*/gi, '');

  // ── CL "print" button text ──
  text = text.replace(/^\s*print\s*$/gm, '');

  // ── Collapse multiple whitespace/newlines into single spaces ──
  text = text.replace(/[\r\n]+/g, ' ');
  text = text.replace(/\s{2,}/g, ' ');

  return text.trim().slice(0, 2000);
}


// ════════════════════════════════════════════════════════════
// END OF PART 1/6
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PART 2/6 — POST-CRAWL FUNCTIONS + CITY/STATE ARRAYS
// ════════════════════════════════════════════════════════════

// ── POST-CRAWL ADDRESS CLEANUP (v3.8) ──
// Runs AFTER all detail pages have enriched listings.
// Removes any listing that STILL has no valid street address.
async function postCrawlAddressCleanup(): Promise<{ cleaned: number; kept: number }> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  POST-CRAWL ADDRESS CLEANUP (v3.8)');
  console.log('  Removing listings that have no valid address');
  console.log('  after detail page enrichment...');
  console.log('══════════════════════════════════════════════════');

  let totalCleaned = 0;
  let totalKept = 0;
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const { data: rows, error } = await supabase
      .from('yard_sales')
      .select('id, address, title')
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Cleanup] Query error: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) break;

    const toDelete = rows.filter(r => {
      const addr = (r.address || '').trim();
      if (addr.length < 8) return true;
      return !/^\d+\s+[\w]+([\s]+[\w]+)*\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Hwy|Highway|Trail|Tr|Terrace|Trl|Loop|Run|Pass|Pike|Alley|Aly)\b/i.test(addr);
    });

    const toKeep = rows.length - toDelete.length;
    totalKept += toKeep;

    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(r => r.id);

      for (let i = 0; i < deleteIds.length; i += 100) {
        const chunk = deleteIds.slice(i, i + 100);
        const { error: delError } = await supabase
          .from('yard_sales')
          .delete()
          .in('id', chunk);

        if (delError) {
          console.error(`[Cleanup] Delete error: ${delError.message}`);
        } else {
          totalCleaned += chunk.length;
        }
      }

      console.log(`[Cleanup] Batch: ${toDelete.length} removed, ${toKeep} kept (offset ${offset})`);
    } else {
      console.log(`[Cleanup] Batch: all ${rows.length} valid (offset ${offset})`);
    }

    if (rows.length < batchSize) break;
    offset += toKeep;
  }

  console.log(`[Cleanup] DONE — ${totalCleaned} removed, ${totalKept} kept with valid addresses`);
  return { cleaned: totalCleaned, kept: totalKept };
}

// ── POST-CRAWL GEOCODING ──
async function geocodeAddress(address: string, city: string, state: string, zip: string): Promise<{ lat: number; lng: number } | null> {
  const query = [address, city, state, zip].filter(Boolean).join(', ');
  if (query.length < 5) return null;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=us&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODE_USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
      };
    }
  } catch {
    // Silently skip geocode failures
  }
  return null;
}

async function postCrawlGeocode(): Promise<number> {
  console.log('\n══════════════════════════════════════════════');
  console.log('  POST-CRAWL GEOCODING');
  console.log('  Finding all rows with null lat/lng...');
  console.log('══════════════════════════════════════════════');

  let totalGeocoded = 0;
  let offset = 0;
  const batchSize = 100;
  const maxTotal = 2000;

  while (offset < maxTotal) {
    const { data: rows, error } = await supabase
      .from('yard_sales')
      .select('id, address, city, state, zip')
      .is('lat', null)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error(`[Geocode] Supabase query error: ${error.message}`);
      break;
    }

    if (!rows || rows.length === 0) {
      console.log('[Geocode] No more rows to geocode.');
      break;
    }

    console.log(`[Geocode] Processing batch of ${rows.length} rows (offset ${offset})...`);

    for (const row of rows) {
      const result = await geocodeAddress(row.address || '', row.city || '', row.state || '', row.zip || '');
      if (result) {
        const { error: updateErr } = await supabase
          .from('yard_sales')
          .update({ lat: result.lat, lng: result.lng })
          .eq('id', row.id);

        if (!updateErr) {
          totalGeocoded++;
        }
      }
      await new Promise(resolve => setTimeout(resolve, GEOCODE_DELAY_MS));
    }

    console.log(`[Geocode] ${totalGeocoded} rows geocoded so far...`);
    offset += batchSize;
  }

  return totalGeocoded;
}

// ── CRAIGSLIST CITIES — ALL 413 US SUBDOMAINS ──
const CRAIGSLIST_CITIES: Record<string, string[]> = {
  AL: ['auburn','birmingham','dothan','florence','gadsden','huntsville','mobile','montgomery','tuscaloosa'],
  AK: ['anchorage','fairbanks','kenai','juneau'],
  AZ: ['flagstaff','mohave','phoenix','prescott','showlow','sierravista','tucson','yuma'],
  AR: ['fayar','fortsmith','jonesboro','littlerock','texarkana'],
  CA: ['bakersfield','chico','fresno','goldcountry','hanford','humboldt','imperial','inlandempire','losangeles','mendocino','merced','modesto','monterey','orangecounty','palmsprings','redding','sacramento','sandiego','sfbay','slo','santabarbara','santamaria','siskiyou','stockton','susanville','ventura','visalia','yubasutter'],
  CO: ['boulder','cosprings','denver','eastco','fortcollins','rockies','pueblo','westslope'],
  CT: ['newlondon','hartford','newhaven','nwct'],
  DE: ['delaware'],
  DC: ['washingtondc'],
  FL: ['broward','daytona','keys','fortlauderdale','fortmyers','gainesville','cfl','jacksonville','lakeland','miami','northcentralfl','ocala','okaloosa','orlando','panamacity','pensacola','sarasota','southflorida','spacecoast','staugustine','tallahassee','tampa','treasure','palmbeach'],
  GA: ['albanyga','athensga','atlanta','augusta','brunswick','columbusga','macon','nwga','savannah','statesboro','valdosta'],
  HI: ['honolulu'],
  ID: ['boise','eastidaho','lewiston','twinfalls'],
  IL: ['bn','chambana','chicago','decatur','lasalle','mattoon','peoria','rockford','carbondale','springfieldil','quincy'],
  IN: ['bloomington','evansville','fortwayne','indianapolis','kokomo','tippecanoe','muncie','richmond','southbend','terrehaute'],
  IA: ['ames','cedarrapids','desmoines','dubuque','fortdodge','iowacity','masoncity','quadcities','siouxcity','ottumwa','waterloo'],
  KS: ['lawrence','manhattan','nwks','salina','seks','swks','topeka','wichita'],
  KY: ['bgky','eastky','lexington','louisville','owensboro','westky'],
  LA: ['batonrouge','cenla','houma','lafayette','lakecharles','monroe','neworleans','shreveport'],
  ME: ['maine'],
  MD: ['annapolis','baltimore','easternshore','frederick','smd','westmd'],
  MA: ['boston','capecod','southcoast','westernmass','worcester'],
  MI: ['annarbor','battlecreek','centralmich','detroit','flint','grandrapids','holland','jxn','kalamazoo','lansing','monroemi','muskegon','nmi','porthuron','saginaw','swmi','thumb','up'],
  MN: ['bemidji','brainerd','duluth','mankato','minneapolis','rmn','marshall','stcloud'],
  MS: ['gulfport','hattiesburg','jackson','meridian','northmiss','natchez'],
  MO: ['columbiamo','joplin','kansascity','kirksville','loz','semo','springfield','stjoseph','stlouis'],
  MT: ['billings','bozeman','butte','greatfalls','helena','kalispell','missoula','montana'],
  NE: ['grandisland','lincoln','northplatte','omaha','scottsbluff'],
  NV: ['elko','lasvegas','reno'],
  NH: ['nh'],
  NJ: ['cnj','jerseyshore','newjersey','southjersey'],
  NM: ['albuquerque','clovis','farmington','lascruces','roswell','santafe'],
  NY: ['albany','binghamton','buffalo','catskills','chautauqua','elmira','fingerlakes','glensfalls','hudsonvalley','ithaca','longisland','newyork','oneonta','plattsburgh','potsdam','rochester','syracuse','twintiers','utica','watertown'],
  NC: ['asheville','boone','charlotte','eastnc','fayetteville','greensboro','hickory','onslow','outerbanks','raleigh','wilmington','winstonsalem'],
  ND: ['bismarck','fargo','grandforks','nd'],
  OH: ['akroncanton','ashtabula','athensohio','chillicothe','cincinnati','cleveland','columbus','dayton','limaohio','mansfield','sandusky','toledo','tuscarawas','youngstown','zanesville'],
  OK: ['lawton','enid','oklahomacity','stillwater','tulsa'],
  OR: ['bend','corvallis','eastoregon','eugene','klamath','medford','oregoncoast','portland','roseburg','salem'],
  PA: ['altoona','chambersburg','erie','harrisburg','lancaster','allentown','meadville','philadelphia','pittsburgh','poconos','reading','scranton','pennstate','williamsport','york'],
  RI: ['providence'],
  SC: ['charleston','columbia','florencesc','greenville','hiltonhead','myrtlebeach'],
  SD: ['siouxfalls','rapidcity','sd'],
  TN: ['chattanooga','clarksville','cookeville','jacksontn','knoxville','memphis','nashville','tricities'],
  TX: ['abilene','amarillo','austin','beaumont','brownsville','collegestation','corpuschristi','dallas','nacogdoches','elpaso','fortworth','galveston','houston','killeen','laredo','lubbock','mcallen','midland','odessa','sanangelo','sanantonio','sanmarcos','texoma','easttexas','victoriatx','waco','wichitafalls'],
  UT: ['logan','ogden','provo','saltlakecity','stgeorge'],
  VT: ['burlington'],
  VA: ['charlottesville','danville','fredericksburg','harrisonburg','lynchburg','blacksburg','norfolk','richmond','roanoke','swva','winchester'],
  WA: ['bellingham','kpr','moseslake','olympic','pullman','seattle','skagit','spokane','wenatchee','yakima'],
  WV: ['charlestonwv','martinsburg','huntington','morgantown','parkersburg','wheeling','wv'],
  WI: ['appleton','eauclaire','greenbay','janesville','lacrosse','madison','milwaukee','racine','sheboygan','wausau'],
  WY: ['wyoming'],
};

// ── ESTATESALES.NET STATES ──
const ESTATE_SALES_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado',
  'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho',
  'Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana',
  'Maine','Maryland','Massachusetts','Michigan','Minnesota',
  'Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New-Hampshire','New-Jersey','New-Mexico','New-York',
  'North-Carolina','North-Dakota','Ohio','Oklahoma','Oregon',
  'Pennsylvania','Rhode-Island','South-Carolina','South-Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington',
  'West-Virginia','Wisconsin','Wyoming',
];

// ── GARAGESALEFINDER STATES ──
const GSF_STATES = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado',
  'Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho',
  'Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana',
  'Maine','Maryland','Massachusetts','Michigan','Minnesota',
  'Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New-Hampshire','New-Jersey','New-Mexico','New-York',
  'North-Carolina','North-Dakota','Ohio','Oklahoma','Oregon',
  'Pennsylvania','Rhode-Island','South-Carolina','South-Dakota',
  'Tennessee','Texas','Utah','Vermont','Virginia','Washington',
  'West-Virginia','Wisconsin','Wyoming',
];

// ── YARDSALESEARCH EXPANDED: 274 CITIES (ALL 50 STATES + DC) ──
const YSS_CITIES = [
  'Birmingham-AL','Huntsville-AL','Mobile-AL','Montgomery-AL','Tuscaloosa-AL',
  'Anchorage-AK','Fairbanks-AK',
  'Phoenix-AZ','Tucson-AZ','Mesa-AZ','Scottsdale-AZ','Chandler-AZ','Flagstaff-AZ',
  'Little-Rock-AR','Fayetteville-AR','Fort-Smith-AR',
  'Los-Angeles-CA','San-Francisco-CA','San-Diego-CA','Sacramento-CA','San-Jose-CA',
  'Fresno-CA','Bakersfield-CA','Riverside-CA','Oakland-CA','Long-Beach-CA',
  'Stockton-CA','Modesto-CA','Santa-Rosa-CA','Irvine-CA','Santa-Barbara-CA',
  'Denver-CO','Colorado-Springs-CO','Aurora-CO','Fort-Collins-CO','Boulder-CO','Pueblo-CO',
  'Hartford-CT','New-Haven-CT','Stamford-CT','Bridgeport-CT','Waterbury-CT',
  'Wilmington-DE','Dover-DE',
  'Washington-DC',
  'Miami-FL','Tampa-FL','Orlando-FL','Jacksonville-FL','Fort-Lauderdale-FL',
  'St-Petersburg-FL','Tallahassee-FL','Sarasota-FL','Pensacola-FL','Daytona-Beach-FL',
  'Fort-Myers-FL','Gainesville-FL','Lakeland-FL','Cape-Coral-FL',
  'Atlanta-GA','Savannah-GA','Augusta-GA','Athens-GA','Macon-GA','Columbus-GA',
  'Honolulu-HI',
  'Boise-ID','Idaho-Falls-ID','Nampa-ID',
  'Chicago-IL','Springfield-IL','Peoria-IL','Naperville-IL','Rockford-IL','Champaign-IL',
  'Indianapolis-IN','Fort-Wayne-IN','Evansville-IN','South-Bend-IN','Bloomington-IN',
  'Des-Moines-IA','Cedar-Rapids-IA','Davenport-IA','Iowa-City-IA','Sioux-City-IA',
  'Wichita-KS','Kansas-City-KS','Topeka-KS','Overland-Park-KS','Lawrence-KS',
  'Louisville-KY','Lexington-KY','Bowling-Green-KY','Owensboro-KY',
  'New-Orleans-LA','Baton-Rouge-LA','Shreveport-LA','Lafayette-LA','Lake-Charles-LA',
  'Portland-ME','Bangor-ME','Augusta-ME',
  'Baltimore-MD','Annapolis-MD','Frederick-MD','Rockville-MD','Silver-Spring-MD',
  'Boston-MA','Worcester-MA','Springfield-MA','Cambridge-MA','Lowell-MA',
  'Detroit-MI','Grand-Rapids-MI','Ann-Arbor-MI','Lansing-MI','Flint-MI',
  'Kalamazoo-MI','Traverse-City-MI',
  'Minneapolis-MN','St-Paul-MN','Duluth-MN','Rochester-MN','Bloomington-MN',
  'Jackson-MS','Gulfport-MS','Hattiesburg-MS','Biloxi-MS',
  'Kansas-City-MO','St-Louis-MO','Springfield-MO','Columbia-MO','Independence-MO',
  'Billings-MT','Missoula-MT','Great-Falls-MT','Bozeman-MT','Helena-MT',
  'Omaha-NE','Lincoln-NE','Grand-Island-NE',
  'Las-Vegas-NV','Reno-NV','Henderson-NV','Sparks-NV',
  'Manchester-NH','Nashua-NH','Concord-NH',
  'Newark-NJ','Jersey-City-NJ','Trenton-NJ','Edison-NJ','Toms-River-NJ','Cherry-Hill-NJ',
  'Albuquerque-NM','Santa-Fe-NM','Las-Cruces-NM','Rio-Rancho-NM',
  'New-York-NY','Buffalo-NY','Rochester-NY','Albany-NY','Syracuse-NY',
  'Yonkers-NY','Utica-NY','Ithaca-NY','Binghamton-NY',
  'Charlotte-NC','Raleigh-NC','Greensboro-NC','Durham-NC','Wilmington-NC',
  'Fayetteville-NC','Asheville-NC','Winston-Salem-NC',
  'Fargo-ND','Bismarck-ND','Grand-Forks-ND','Minot-ND',
  'Columbus-OH','Cleveland-OH','Cincinnati-OH','Dayton-OH','Toledo-OH',
  'Akron-OH','Canton-OH','Youngstown-OH',
  'Oklahoma-City-OK','Tulsa-OK','Norman-OK','Broken-Arrow-OK','Edmond-OK',
  'Portland-OR','Eugene-OR','Salem-OR','Bend-OR','Medford-OR','Corvallis-OR',
  'Philadelphia-PA','Pittsburgh-PA','Harrisburg-PA','Allentown-PA','Erie-PA',
  'Reading-PA','Scranton-PA','Lancaster-PA','York-PA',
  'Providence-RI','Warwick-RI','Cranston-RI',
  'Charleston-SC','Columbia-SC','Greenville-SC','Myrtle-Beach-SC','Rock-Hill-SC',
  'Sioux-Falls-SD','Rapid-City-SD','Aberdeen-SD',
  'Nashville-TN','Memphis-TN','Knoxville-TN','Chattanooga-TN','Clarksville-TN',
  'Murfreesboro-TN',
  'Houston-TX','Dallas-TX','Austin-TX','San-Antonio-TX','Fort-Worth-TX',
  'El-Paso-TX','Arlington-TX','Plano-TX','Lubbock-TX','Corpus-Christi-TX',
  'Laredo-TX','Amarillo-TX','Waco-TX','Midland-TX',
  'Salt-Lake-City-UT','Provo-UT','Ogden-UT','St-George-UT','Logan-UT',
  'Burlington-VT','Rutland-VT',
  'Virginia-Beach-VA','Richmond-VA','Norfolk-VA','Chesapeake-VA',
  'Arlington-VA','Roanoke-VA','Lynchburg-VA','Charlottesville-VA',
  'Seattle-WA','Olympia-WA','Tacoma-WA','Spokane-WA','Bellingham-WA',
  'Vancouver-WA','Yakima-WA','Kennewick-WA','Everett-WA',
  'Charleston-WV','Huntington-WV','Morgantown-WV','Parkersburg-WV',
  'Milwaukee-WI','Madison-WI','Green-Bay-WI','Appleton-WI','Kenosha-WI','Eau-Claire-WI',
  'Cheyenne-WY','Casper-WY',
];

// ── GSALR.COM STATES (ScraperAPI-only, 403 without proxy) ──
const GSALR_STATES = [
  'alabama','alaska','arizona','arkansas','california','colorado',
  'connecticut','delaware','florida','georgia','hawaii','idaho',
  'illinois','indiana','iowa','kansas','kentucky','louisiana',
  'maine','maryland','massachusetts','michigan','minnesota',
  'mississippi','missouri','montana','nebraska','nevada',
  'new-hampshire','new-jersey','new-mexico','new-york',
  'north-carolina','north-dakota','ohio','oklahoma','oregon',
  'pennsylvania','rhode-island','south-carolina','south-dakota',
  'tennessee','texas','utah','vermont','virginia','washington',
  'west-virginia','wisconsin','wyoming',
];
const GSALR_MAX_PAGES = 3;


// ════════════════════════════════════════════════════════════
// END OF PART 2/6
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PART 3/6 — buildStartUrls() + saveBatchToSupabase() + main() START + CL HANDLERS
// ════════════════════════════════════════════════════════════

// ── BUILD START URLs FOR ALL 5 SOURCES ──
function buildStartUrls(): { url: string; userData: { source: string; state?: string; pageType: string } }[] {
  const urls: { url: string; userData: { source: string; state?: string; pageType: string } }[] = [];

  // ── CRAIGSLIST: /gms + /sss across all 413 subdomains ──
  for (const [state, cities] of Object.entries(CRAIGSLIST_CITIES)) {
    for (const city of cities) {
      // Garage/Moving Sales section
      for (let page = 0; page < CL_MAX_PAGES; page++) {
        const offset = page * 120;
        const gmsUrl = offset === 0
          ? `https://${city}.craigslist.org/search/gms`
          : `https://${city}.craigslist.org/search/gms?s=${offset}`;
        urls.push({ url: gmsUrl, userData: { source: 'craigslist', state, pageType: 'cl_index' } });
      }

      // /sss general yard sale query
      for (let page = 0; page < CL_MAX_PAGES; page++) {
        const offset = page * 120;
        const sssUrl = offset === 0
          ? `https://${city}.craigslist.org/search/sss?query=yard+sale+garage+sale`
          : `https://${city}.craigslist.org/search/sss?query=yard+sale+garage+sale&s=${offset}`;
        urls.push({ url: sssUrl, userData: { source: 'craigslist', state, pageType: 'cl_index' } });
      }

      // /sss estate sale sub-query
      urls.push({
        url: `https://${city}.craigslist.org/search/sss?query=estate+sale`,
        userData: { source: 'craigslist', state, pageType: 'cl_index' },
      });

      // /sss moving sale sub-query
      urls.push({
        url: `https://${city}.craigslist.org/search/sss?query=moving+sale`,
        userData: { source: 'craigslist', state, pageType: 'cl_index' },
      });
    }
  }

  // ── ESTATESALES.NET: 50 states × 5 pages ──
  for (const state of ESTATE_SALES_STATES) {
    for (let page = 1; page <= ES_MAX_PAGES; page++) {
      const url = page === 1
        ? `https://www.estatesales.net/${state}`
        : `https://www.estatesales.net/${state}?page=${page}`;
      urls.push({ url, userData: { source: 'estatesales', state, pageType: 'es_index' } });
    }
  }

  // ── GARAGESALEFINDER: 50 states × 5 pages ──
  for (const state of GSF_STATES) {
    for (let page = 1; page <= GSF_MAX_PAGES; page++) {
      const url = page === 1
        ? `https://www.garagesalefinder.com/sale/${state}`
        : `https://www.garagesalefinder.com/sale/${state}?page=${page}`;
      urls.push({ url, userData: { source: 'garagesalefinder', state, pageType: 'gsf_index' } });
    }
  }

  // ── YARDSALESEARCH: 274 cities × 5 pages ──
  for (const city of YSS_CITIES) {
    for (let page = 1; page <= YSS_MAX_PAGES; page++) {
      const url = page === 1
        ? `https://www.yardsalesearch.com/garage-sales-in-${city}.html`
        : `https://www.yardsalesearch.com/garage-sales-in-${city}.html?page=${page}`;
      urls.push({ url, userData: { source: 'yardsalesearch', state: city.split('-').pop() || '', pageType: 'yss_index' } });
    }
  }

  // ── GSALR.COM: 50 states × 3 pages (ScraperAPI-only) ──
  if (SCRAPER_API_KEY) {
    for (const state of GSALR_STATES) {
      for (let page = 1; page <= GSALR_MAX_PAGES; page++) {
        const url = page === 1
          ? `https://gsalr.com/garage-sales-in/${state}/`
          : `https://gsalr.com/garage-sales-in/${state}/page/${page}/`;
        urls.push({ url, userData: { source: 'gsalr', state, pageType: 'gsalr_index' } });
      }
    }
  }

  return urls;
}

// ── SAVE BATCH TO SUPABASE (upsert in sub-batches of 50) ──
async function saveBatchToSupabase(sales: ScrapedSale[]): Promise<number> {
  const validSales = sales.filter(s => s.title && s.title.trim().length > 0);
  if (validSales.length === 0) return 0;

  let totalSaved = 0;

  for (let i = 0; i < validSales.length; i += 50) {
    const chunk = validSales.slice(i, i + 50);
    const { error } = await supabase
      .from('yard_sales')
      .upsert(chunk, { onConflict: 'source_url' });

    if (error) {
      console.error(`[SaveBatch] Supabase upsert error: ${error.message}`);
    } else {
      totalSaved += chunk.length;
    }
  }

  return totalSaved;
}

// ══════════════════════════════════════════════════════════════
// MAIN FUNCTION — CRAWLER SETUP & ALL REQUEST HANDLERS
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  CRAWLEE DEEP SCRAPER v4.0                      ║');
  console.log('║  CLEAN DESCRIPTIONS + TIME FIX + ALL v3.8 FEATS ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Started at: ${new Date().toISOString()}`);

  await purgeDefaultStorages();

  const startUrls = buildStartUrls();

  // Count URLs by source
  const sourceCounts: Record<string, number> = {};
  for (const u of startUrls) {
    const src = u.userData.source;
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  console.log('\n📋 Start URL breakdown:');
  for (const [src, count] of Object.entries(sourceCounts)) {
    console.log(`   ${src}: ${count} URLs`);
  }
  console.log(`   TOTAL: ${startUrls.length} URLs\n`);

  // ── Proxy config (ScraperAPI) ──
  let proxyConfiguration: ProxyConfiguration | undefined;
  if (SCRAPER_API_KEY) {
    proxyConfiguration = new ProxyConfiguration({
      proxyUrls: [
        `http://scraperapi.country_code=us:${SCRAPER_API_KEY}@proxy-server.scraperapi.com:8001`,
      ],
    });
    console.log('🔒 ScraperAPI proxy configured.');
  } else {
    console.log('⚠️  No ScraperAPI key — Gsalr will be skipped.');
  }

  // ── Tracking variables ──
  const pendingSales: ScrapedSale[] = [];
  const seenIds = new Set<string>();
  let processedCount = 0;
  let skippedCount = 0;
  let detailCount = 0;
  let savedCount = 0;

  // ── CRAWLER INSTANCE ──
  const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 2,
    minConcurrency: 1,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    requestHandler: async ({ request, $, enqueueLinks }) => {
      const { source, state, pageType } = request.userData as {
        source: string;
        state?: string;
        pageType: string;
      };

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 1: CRAIGSLIST INDEX                     ║
      // ╚══════════════════════════════════════════════════╝
      if (pageType === 'cl_index') {
        sourceStats.craigslist.success++;
        const listings = $('li.cl-static-search-result, .result-row, .cl-search-result, .cl-search-result-item');

        listings.each((_i, el) => {
          try {
            const titleEl = $(el).find('.title, .result-title, .titlestring, .posting-title .label, .cl-app-anchor .label');
            const title = titleEl.text().trim();
            if (!title) return;

            const linkEl = $(el).find('a[href]').first();
            const href = linkEl.attr('href') || '';
            const sourceUrl = href.startsWith('http') ? href : `https://${request.url.split('/')[2]}${href}`;
            const sourceId = `cl-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-40)}`;

            if (seenIds.has(sourceId)) return;

            // Location / address
            const locationEl = $(el).find('.result-hood, .nearby, .supertitle, .meta');
            const locationText = locationEl.text().trim();
            const address = extractAddressFromText(locationText) || locationText.replace(/[()]/g, '').trim();

            // ── Gate: must be a yard-sale-type post ──
            if (!isYardSale(title, locationText)) {
              skippedCount++;
              return;
            }

            seenIds.add(sourceId);

            // Date, price, image
            const dateText = $(el).find('.result-date, time, .date, .meta').text().trim();
            const dateStart = extractDateFromText(dateText) || new Date().toISOString().split('T')[0];
            const priceEl = $(el).find('.result-price, .price, .priceinfo');
            const price = priceEl.text().trim() || null;
            const imgEl = $(el).find('img').first();
            const imgUrl = getImgUrl(imgEl, $);
            const imageUrls = imgUrl ? [imgUrl] : [];

            const sale: ScrapedSale = {
              source_id: sourceId,
              title,
              description: '',
              address,
              city: '',
              state: state || '',
              zip: extractZip(locationText),
              lat: null,
              lng: null,
              date_start: dateStart,
              date_end: null,
              time_start: null,
              time_end: null,
              price_range: price,
              categories: guessCategories(title),
              source: 'craigslist',
              source_url: sourceUrl,
              image_urls: imageUrls,
              expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
              scraped_at: new Date().toISOString(),
              pushed: false,
            };

            pendingSales.push(sale);
            sourceStats.craigslist.listings++;
            processedCount++;

            // Enqueue detail page if it looks like a direct listing link
            if (href && (/\/d\//.test(href) || /\/\d+\.html/.test(href))) {
              crawler.addRequests([{
                url: sourceUrl,
                userData: { source: 'craigslist', state, pageType: 'cl_detail', sourceId },
              }]);
              detailCount++;
            }
          } catch (err) {
            console.error(`[CL Index] Error parsing listing: ${(err as Error).message}`);
          }
        });

        // Save batch if enough pending
        if (pendingSales.length >= SAVE_BATCH_SIZE) {
          const batch = pendingSales.splice(0, pendingSales.length);
          const saved = await saveBatchToSupabase(batch);
          savedCount += saved;
          console.log(`[CL Index] Flushed ${saved} listings to DB (total saved: ${savedCount})`);
        }
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 2: CRAIGSLIST DETAIL (v4.0 FIXED)       ║
      // ║  ★ Cascading selector — no more junk text ★      ║
      // ║  ★ cleanDescription() applied ★                  ║
      // ║  ★ normalizeTime() for "8undefined AM" fix ★     ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'cl_detail') {
        const { sourceId } = request.userData as { sourceId?: string };

        // ── v4.0 FIX: Cascading fallback instead of comma-join ──
        // BEFORE (broken): $('#postingbody, .posting-body, .body, section.body').text()
        // .body and section.body matched Craigslist's outer page containers,
        // pulling in nav arrows, action buttons, post IDs, QR text, scam warnings, etc.
        const bodyText = $('#postingbody').text().trim()
          || $('.posting-body').text().trim()
          || '';

        // Map address from detail page
        const mapAddress = $('div.mapaddress, .mapAndAttrs .mapaddress').text().trim();

        // Geo coordinates from CL data attributes
        const mapEl = $('[data-latitude]').first();
        const lat = mapEl.length ? parseFloat(mapEl.attr('data-latitude') || '') : null;
        const lng = mapEl.length ? parseFloat(mapEl.attr('data-longitude') || '') : null;

        // ── Image extraction (v3.1 multi-attribute + CL data-ids) ──
        const clImages = parseCraigslistDataIds($);
        const pageImages = clImages.length > 0 ? clImages : getAllImgUrls($('body'), $);

        // ── Times and dates from body text ──
        const times = extractTimes(bodyText);
        const detailDate = extractDateFromText(bodyText);

        // ── Try to enrich existing pending sale ──
        const existingSale = sourceId
          ? pendingSales.find(s => s.source_id === sourceId)
          : null;

        if (existingSale) {
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (bodyText) existingSale.description = cleanDescription(bodyText);
          if (mapAddress && hasValidAddress(mapAddress)) existingSale.address = mapAddress;
          if (lat && lng) { existingSale.lat = lat; existingSale.lng = lng; }
          if (pageImages.length > 0) existingSale.image_urls = pageImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (detailDate) existingSale.date_start = detailDate;
        } else {
          // Already flushed to DB → update row directly
          const updateData: Record<string, unknown> = {};
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (bodyText) updateData.description = cleanDescription(bodyText);
          if (mapAddress && hasValidAddress(mapAddress)) updateData.address = mapAddress;
          if (lat && lng) { updateData.lat = lat; updateData.lng = lng; }
          if (pageImages.length > 0) updateData.image_urls = pageImages;
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;
          if (detailDate) updateData.date_start = detailDate;

          if (sourceId && Object.keys(updateData).length > 0) {
            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_id', sourceId);

            if (error) {
              console.error(`[CL Detail] DB update error for ${sourceId}: ${error.message}`);
            }
          }
        }
      }


// ════════════════════════════════════════════════════════════
// END OF PART 3/6
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PART 4/6 — ESTATESALES.NET HANDLERS + GARAGESALEFINDER HANDLERS
// ════════════════════════════════════════════════════════════

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 3: ESTATESALES.NET INDEX                ║
      // ║  JSON-LD + HTML card fallback                    ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'es_index') {
        const detailUrls: string[] = [];

        // Strategy 1: JSON-LD structured data
        $('script[type="application/ld+json"]').each((_i, el) => {
          try {
            const data = JSON.parse($(el).html() || '');
            const events = Array.isArray(data) ? data : [data];
            for (const event of events) {
              if (event['@type'] !== 'Event' && event['@type'] !== 'Sale') continue;

              const name = event.name || '';
              const eventUrl = event.url || '';
              const desc = event.description || '';
              const loc = event.location || {};
              const addr = loc.address || {};

              const fullUrl = eventUrl.startsWith('http')
                ? eventUrl
                : `https://www.estatesales.net${eventUrl}`;
              const sourceId = `es-deep-${fullUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

              if (seenIds.has(sourceId)) continue;
              seenIds.add(sourceId);

              pendingSales.push({
                source_id: sourceId,
                title: name,
                description: desc,
                address: addr.streetAddress || '',
                city: addr.addressLocality || '',
                state: addr.addressRegion || state || '',
                zip: addr.postalCode || '',
                lat: loc.geo?.latitude ? parseFloat(loc.geo.latitude) : null,
                lng: loc.geo?.longitude ? parseFloat(loc.geo.longitude) : null,
                date_start: event.startDate
                  ? event.startDate.split('T')[0]
                  : new Date().toISOString().split('T')[0],
                date_end: event.endDate ? event.endDate.split('T')[0] : null,
                time_start: null,
                time_end: null,
                price_range: null,
                categories: ['Estate Sale'],
                source: 'estatesales.net',
                source_url: fullUrl,
                image_urls: event.image
                  ? (Array.isArray(event.image) ? event.image : [event.image])
                  : [],
                expires_at: event.endDate
                  || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                scraped_at: new Date().toISOString(),
                pushed: false,
              });

              if (fullUrl.includes('estatesales.net/')) detailUrls.push(fullUrl);
            }
          } catch { /* skip bad JSON-LD */ }
        });

        // Strategy 2: HTML card fallback
        $('.sale-item, .saleCard, .listing-card, .es-card, [class*="saleCard"], [class*="sale-card"], .sale-list-item').each((_i, el) => {
          const title = $(el).find('.sale-title, h3, h2, .title, [class*="sale-title"], [class*="saleTitle"]').first().text().trim();
          const address = $(el).find('.address, .sale-location, .location, [class*="address"], [class*="location"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.estatesales.net${link}`;
          const sourceId = `es-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const imgSrc = getImgUrl($(el), $);
          const dateText = $(el).find('.date, .sale-date, [class*="date"]').first().text().trim();
          const parsedDate = extractDateFromText(dateText);

          pendingSales.push({
            source_id: sourceId,
            title: `Estate Sale: ${title}`,
            description: '',
            address,
            city: '',
            state: state || '',
            zip: extractZip(address),
            lat: null,
            lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: ['Estate Sale'],
            source: 'estatesales.net',
            source_url: fullLink,
            image_urls: imgSrc ? [imgSrc] : [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          if (link && !seenIds.has('detail-' + fullLink)) detailUrls.push(fullLink);
        });

        // Enqueue detail pages
        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'estatesales', state, pageType: 'es_detail' },
          })));
          detailCount += detailUrls.length;
        }

        sourceStats.estatesales.success++;
        sourceStats.estatesales.listings += detailUrls.length;
        console.log(`  ✅ [ES] ${request.url.slice(0, 60)} → ${detailUrls.length} listings`);
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 4: ESTATESALES.NET DETAIL               ║
      // ║  ★ v4.0: cleanDescription() applied ★            ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'es_detail') {
        const sourceUrl = request.url;
        const sourceId = `es-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const fullAddress = $('.full-address, .sale-address, [class*="address"], [itemprop="streetAddress"]').text().trim();
        const cityEl = $('[itemprop="addressLocality"]').text().trim();
        const stateEl = $('[itemprop="addressRegion"]').text().trim();
        const zipEl = $('[itemprop="postalCode"]').text().trim();
        const description = $('.sale-description, .description, [class*="description"]').text().trim();

        // Image extraction with lazy-load support
        const allImages: string[] = [];
        $('.sale-photo img, .photo-gallery img, [class*="gallery"] img, [class*="photo"] img, .sale-images img, .slider img').each((_i, img) => {
          const src = $(img).attr('src')
            || $(img).attr('data-src')
            || $(img).attr('data-lazy')
            || $(img).attr('data-lazy-src')
            || $(img).attr('data-original')
            || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('spacer') && src.length > 10) {
            allImages.push(src);
          }
        });

        const dateSection = $('.sale-dates, .dates, [class*="date"]').text().trim();
        const times = extractTimes(dateSection);
        const parsedDate = extractDateFromText(dateSection);

        if (existingSale) {
          if (fullAddress && hasValidAddress(fullAddress)) existingSale.address = fullAddress;
          if (cityEl) existingSale.city = cityEl;
          if (stateEl) existingSale.state = stateEl;
          if (zipEl) existingSale.zip = zipEl;
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (description) existingSale.description = cleanDescription(description);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          console.log(`  📝 [ES detail] enriched: ${existingSale.title.slice(0, 50)}`);
        } else {
          // Already flushed to DB → update directly
          if (allImages.length > 0 || fullAddress || description) {
            const updateData: Record<string, unknown> = {};
            if (allImages.length > 0) updateData.image_urls = allImages;
            if (fullAddress && hasValidAddress(fullAddress)) updateData.address = fullAddress;
            if (cityEl) updateData.city = cityEl;
            if (stateEl) updateData.state = stateEl;
            if (zipEl) updateData.zip = zipEl;
            // ★ v4.0: cleanDescription()
            if (description) updateData.description = cleanDescription(description);
            if (times.time_start) updateData.time_start = times.time_start;
            if (times.time_end) updateData.time_end = times.time_end;
            if (parsedDate) updateData.date_start = parsedDate;

            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', sourceUrl);

            if (error) {
              console.log(`  ⚠️ [ES detail] DB update failed: ${error.message}`);
            } else {
              console.log(`  📸 [ES detail] updated DB directly: ${allImages.length} photos + enrichment`);
            }
          }
        }
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 5: GARAGESALEFINDER INDEX               ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'gsf_index') {
        const detailUrls: string[] = [];

        // Primary listing cards
        $('div[class*="saleListing"], div[class*="sale-listing"], div[class*="SaleListing"], .listing-item, .sale-item, .garage-sale-item, [class*="listingCard"]').each((_i, el) => {
          const title = $(el).find('h2, h3, h4, a strong, a b, .sale-title, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.garagesalefinder.com${link}`;
          const sourceId = `gsf-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = getImgUrl($(el), $);
          const dateText = $(el).find('.date, [class*="date"]').text().trim();
          const parsedDate = extractDateFromText(dateText);
          const times = extractTimes(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '',
            state: state || '',
            zip: extractZip(bodyText),
            lat: null,
            lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start,
            time_end: times.time_end,
            price_range: null,
            categories: guessCategories(title),
            source: 'garagesalefinder.com',
            source_url: fullLink,
            image_urls: imgSrc ? [imgSrc] : [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          if (link.match(/\/sale\/\d/) || link.match(/\/yard-sale\//)) {
            detailUrls.push(fullLink);
          }
        });

        // Fallback: anchors with sale links
        $('a[href*="/sale/"]').each((_i, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr('href') || '';
          if (!title || title.length < 5 || !link.match(/\/sale\/\d/)) return;

          const fullLink = link.startsWith('http') ? link : `https://www.garagesalefinder.com${link}`;
          const sourceId = `gsf-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address: '',
            city: '',
            state: state || '',
            zip: '',
            lat: null,
            lng: null,
            date_start: new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'garagesalefinder.com',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          detailUrls.push(fullLink);
        });

        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'garagesalefinder', state, pageType: 'gsf_detail' },
          })));
          detailCount += detailUrls.length;
        }

        sourceStats.garagesalefinder.success++;
        sourceStats.garagesalefinder.listings += detailUrls.length;
        console.log(`  ✅ [GSF] ${request.url.slice(0, 60)} → ${detailUrls.length} listings`);
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 6: GARAGESALEFINDER DETAIL              ║
      // ║  ★ v4.0: cleanDescription() applied ★            ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'gsf_detail') {
        const sourceUrl = request.url;
        const sourceId = `gsf-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], #sale-details, .details').text().trim();

        // Image extraction with lazy-load support
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img, img[data-src], img[data-lazy], [class*="photo"] img, [class*="gallery"] img').each((_i, img) => {
          const src = $(img).attr('src')
            || $(img).attr('data-src')
            || $(img).attr('data-lazy')
            || $(img).attr('data-lazy-src')
            || $(img).attr('data-original')
            || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('spacer') && src.length > 10) {
            allImages.push(src);
          }
        });

        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (description) existingSale.description = cleanDescription(description);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [GSF detail] enriched: ${existingSale.title.slice(0, 50)}`);
        } else {
          // Already flushed to DB → update directly
          if (allImages.length > 0 || detailAddress || description) {
            const updateData: Record<string, unknown> = {};
            if (allImages.length > 0) updateData.image_urls = allImages;
            if (detailAddress && hasValidAddress(detailAddress)) updateData.address = detailAddress;
            // ★ v4.0: cleanDescription()
            if (description) updateData.description = cleanDescription(description);
            if (times.time_start) updateData.time_start = times.time_start;
            if (times.time_end) updateData.time_end = times.time_end;
            if (parsedDate) updateData.date_start = parsedDate;
            const bodyZip = extractZip(bodyText);
            if (bodyZip) updateData.zip = bodyZip;

            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', sourceUrl);

            if (error) {
              console.log(`  ⚠️ [GSF detail] DB update failed: ${error.message}`);
            } else {
              console.log(`  📸 [GSF detail] updated DB directly: ${allImages.length} photos + enrichment`);
            }
          }
        }
      }


// ════════════════════════════════════════════════════════════
// END OF PART 4/6
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PART 5/6 — YARDSALESEARCH HANDLERS + GSALR INDEX HANDLER
// ════════════════════════════════════════════════════════════

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 7: YARDSALESEARCH INDEX                 ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'yss_index') {
        const detailUrls: string[] = [];

        $('div[class*="listing"], div[class*="Listing"], .sale-listing, .result-item, .sale-item, .yard-sale-item, [class*="saleResult"]').each((_i, el) => {
          const title = $(el).find('h2, h3, h4, strong, b, .title, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.yardsalesearch.com${link}`;
          const sourceId = `yss-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = getImgUrl($(el), $);
          const times = extractTimes(bodyText);
          const parsedDate = extractDateFromText(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '',
            state: state || '',
            zip: extractZip(bodyText),
            lat: null,
            lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start,
            time_end: times.time_end,
            price_range: null,
            categories: guessCategories(title),
            source: 'yardsalesearch.com',
            source_url: fullLink,
            image_urls: imgSrc ? [imgSrc] : [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          if (link && link.includes('.html') && link !== request.url) {
            detailUrls.push(fullLink);
          }
        });

        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'yardsalesearch', state, pageType: 'yss_detail' },
          })));
          detailCount += detailUrls.length;
        }

        sourceStats.yardsalesearch.success++;
        sourceStats.yardsalesearch.listings += detailUrls.length;
        console.log(`  ✅ [YSS] ${request.url.slice(0, 60)} → ${detailUrls.length} listings`);
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 8: YARDSALESEARCH DETAIL                ║
      // ║  ★ v4.0: cleanDescription() applied ★            ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'yss_detail') {
        const sourceUrl = request.url;
        const sourceId = `yss-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], .details, #details').text().trim();

        // Image extraction with lazy-load support
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img, img[data-src], img[data-lazy], [class*="photo"] img, [class*="gallery"] img').each((_i, img) => {
          const src = $(img).attr('src')
            || $(img).attr('data-src')
            || $(img).attr('data-lazy')
            || $(img).attr('data-lazy-src')
            || $(img).attr('data-original')
            || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('spacer') && src.length > 10) {
            allImages.push(src);
          }
        });

        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (description) existingSale.description = cleanDescription(description);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [YSS detail] enriched: ${existingSale.title.slice(0, 50)}`);
        } else {
          // Already flushed to DB → update directly
          if (allImages.length > 0 || detailAddress || description) {
            const updateData: Record<string, unknown> = {};
            if (allImages.length > 0) updateData.image_urls = allImages;
            if (detailAddress && hasValidAddress(detailAddress)) updateData.address = detailAddress;
            // ★ v4.0: cleanDescription()
            if (description) updateData.description = cleanDescription(description);
            if (times.time_start) updateData.time_start = times.time_start;
            if (times.time_end) updateData.time_end = times.time_end;
            if (parsedDate) updateData.date_start = parsedDate;
            const bodyZip = extractZip(bodyText);
            if (bodyZip) updateData.zip = bodyZip;

            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', sourceUrl);

            if (error) {
              console.log(`  ⚠️ [YSS detail] DB update failed: ${error.message}`);
            } else {
              console.log(`  📸 [YSS detail] updated DB directly: ${allImages.length} photos + enrichment`);
            }
          }
        }
      }

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 9: GSALR.COM INDEX (ScraperAPI-only)    ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'gsalr_index') {
        const detailUrls: string[] = [];

        // Primary listing cards
        $('div.sale, .sale-listing, .listing, article, .result, .sale-item, [class*="sale"], [class*="listing"]').each((_i, el) => {
          const title = $(el).find('h2, h3, h4, .title, a strong, a b, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';

          if (!title || title.length < 5 || title.length > 300) return;

          const fullLink = link.startsWith('http') ? link : `https://gsalr.com${link}`;
          const sourceId = `gsalr-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = getImgUrl($(el), $);
          const times = extractTimes(bodyText);
          const parsedDate = extractDateFromText(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '',
            state: state || '',
            zip: extractZip(bodyText),
            lat: null,
            lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start,
            time_end: times.time_end,
            price_range: null,
            categories: guessCategories(title),
            source: 'gsalr.com',
            source_url: fullLink,
            image_urls: imgSrc ? [imgSrc] : [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          // Enqueue detail pages
          if (link && (link.includes('/sale') || link.includes('/garage-sale'))) {
            detailUrls.push(fullLink);
          }
        });

        // Fallback: grab any listing links on the page
        $('a[href*="/sale"], a[href*="/garage-sale"]').each((_i, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr('href') || '';
          if (!title || title.length < 5 || title.length > 300) return;

          const fullLink = link.startsWith('http') ? link : `https://gsalr.com${link}`;
          const sourceId = `gsalr-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).parent().text();
          const times = extractTimes(bodyText);
          const parsedDate = extractDateFromText(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address: extractAddressFromText(bodyText) || '',
            city: '',
            state: state || '',
            zip: extractZip(bodyText),
            lat: null,
            lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start,
            time_end: times.time_end,
            price_range: null,
            categories: guessCategories(title),
            source: 'gsalr.com',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });

          detailUrls.push(fullLink);
        });

        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'gsalr', state, pageType: 'gsalr_detail' },
          })));
          detailCount += detailUrls.length;
        }

        sourceStats.gsalr.success++;
        sourceStats.gsalr.listings += detailUrls.length;
        console.log(`  ✅ [GSALR] ${request.url.slice(0, 60)} → ${detailUrls.length} listings`);
      }


// ════════════════════════════════════════════════════════════
// END OF PART 5/6
// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════
// PART 6/6 — GSALR DETAIL + BATCH SAVE + FAIL HANDLER + RUNNER + POST-CRAWL + STATS
// ════════════════════════════════════════════════════════════

      // ╔══════════════════════════════════════════════════╗
      // ║  HANDLER 10: GSALR.COM DETAIL (ScraperAPI-only)  ║
      // ║  ★ v4.0: cleanDescription() applied ★            ║
      // ╚══════════════════════════════════════════════════╝
      else if (pageType === 'gsalr_detail') {
        const sourceUrl = request.url;
        const sourceId = `gsalr-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], .details, #details').text().trim();

        // Image extraction with lazy-load support
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img, img[data-src], img[data-lazy], [class*="photo"] img, [class*="gallery"] img').each((_i, img) => {
          const src = $(img).attr('src')
            || $(img).attr('data-src')
            || $(img).attr('data-lazy')
            || $(img).attr('data-lazy-src')
            || $(img).attr('data-original')
            || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('spacer') && src.length > 10) {
            allImages.push(src);
          }
        });

        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          // ★ v4.0: cleanDescription() instead of raw .slice(0,2000)
          if (description) existingSale.description = cleanDescription(description);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [GSALR detail] enriched: ${existingSale.title.slice(0, 50)}`);
        } else {
          // Already flushed to DB → update directly
          if (allImages.length > 0 || detailAddress || description) {
            const updateData: Record<string, unknown> = {};
            if (allImages.length > 0) updateData.image_urls = allImages;
            if (detailAddress && hasValidAddress(detailAddress)) updateData.address = detailAddress;
            // ★ v4.0: cleanDescription()
            if (description) updateData.description = cleanDescription(description);
            if (times.time_start) updateData.time_start = times.time_start;
            if (times.time_end) updateData.time_end = times.time_end;
            if (parsedDate) updateData.date_start = parsedDate;
            const bodyZip = extractZip(bodyText);
            if (bodyZip) updateData.zip = bodyZip;

            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', sourceUrl);

            if (error) {
              console.log(`  ⚠️ [GSALR detail] DB update failed: ${error.message}`);
            } else {
              console.log(`  📸 [GSALR detail] updated DB directly: ${allImages.length} photos + enrichment`);
            }
          }
        }
      }

      // ══════════════════════════════════════════════════
      // BATCH SAVE — every SAVE_BATCH_SIZE (25) sales
      // ══════════════════════════════════════════════════
      if (pendingSales.length >= SAVE_BATCH_SIZE) {
        const batch = pendingSales.splice(0, pendingSales.length);
        const saved = await saveBatchToSupabase(batch);
        savedCount += saved;
        console.log(`  💾 [Save] ${saved} sales saved to Supabase (${savedCount} total, ${seenIds.size} unique found)`);
      }

      // Progress log every 25 pages
      if (processedCount % 25 === 0) {
        const elapsed = ((Date.now() - crawlStartTime) / 1000 / 60).toFixed(1);
        console.log(`\n  ═══ [Progress] ${processedCount} pages | ${detailCount} detail | ${seenIds.size} unique | ${savedCount} saved | ${skippedCount} failed | ${elapsed} min ═══\n`);
      }

      // 2s delay between requests — critical for CL rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    },

    // ══════════════════════════════════════════════════
    // FAILED REQUEST HANDLER
    // ══════════════════════════════════════════════════
    async failedRequestHandler({ request, error }) {
      skippedCount++;
      const { source } = request.userData as { source: string };
      if (sourceStats[source]) sourceStats[source].failed++;

      const shortUrl = request.url.replace(/https?:\/\/(www\.)?/, '').slice(0, 70);
      const errMsg = (error as Error)?.message?.slice(0, 80) || 'Unknown error';
      console.log(`  ❌ [FAIL #${skippedCount}] [${source}] ${shortUrl} — ${errMsg}`);
    },
  });

  // ══════════════════════════════════════════════════════════
  // ADD URLs AND RUN THE CRAWLER
  // ══════════════════════════════════════════════════════════
  console.log(`\nAdding ${startUrls.length} URLs to queue...`);
  await crawler.addRequests(startUrls);
  console.log('Starting Crawlee v4.0...\n');
  await crawler.run();

  // ══════════════════════════════════════════════════════════
  // FINAL SAVE — flush any remaining pendingSales
  // ══════════════════════════════════════════════════════════
  if (pendingSales.length > 0) {
    const saved = await saveBatchToSupabase(pendingSales);
    savedCount += saved;
    console.log(`  💾 [Final Save] ${saved} remaining sales saved (${savedCount} total)`);
    pendingSales.length = 0;
  }

  const crawlDuration = (Date.now() - crawlStartTime) / 1000;

  // ══════════════════════════════════════════════════════════
  // CRAWL PHASE STATS — per-source breakdown
  // ══════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CRAWL PHASE COMPLETE — SOURCE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════');
  for (const [src, stats] of Object.entries(sourceStats)) {
    console.log(`  ${src.toUpperCase()}: ${stats.success} pages OK, ${stats.failed} failed, ${stats.listings} listings`);
  }
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Total pages crawled: ${processedCount}`);
  console.log(`  Total detail pages:  ${detailCount}`);
  console.log(`  Total pages failed:  ${skippedCount}`);
  console.log(`  Unique sales found:  ${seenIds.size}`);
  console.log(`  Sales saved to DB:   ${savedCount}`);
  console.log(`  Crawl duration:      ${crawlDuration.toFixed(1)}s (${(crawlDuration / 60).toFixed(1)} min)`);
  console.log('═══════════════════════════════════════════════════════');

  // ══════════════════════════════════════════════════════════
  // POST-CRAWL ADDRESS CLEANUP (v3.8)
  // Removes listings with no valid street address
  // ══════════════════════════════════════════════════════════
  const { cleaned, kept } = await postCrawlAddressCleanup();

  // ══════════════════════════════════════════════════════════
  // POST-CRAWL GEOCODING
  // Only geocodes rows that survived cleanup
  // ══════════════════════════════════════════════════════════
  const geocoded = await postCrawlGeocode();

  // ══════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════
  const totalDuration = (Date.now() - crawlStartTime) / 1000;
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(' CRAWLEE DEEP SCRAPER v4.0 — ALL DONE');
  console.log(`  Sales saved:         ${savedCount}`);
  console.log(`  Address cleanup:     ${cleaned} removed, ${kept} kept`);
  console.log(`  Sales geocoded:      ${geocoded}`);
  console.log(`  Total duration:      ${totalDuration.toFixed(1)}s (${(totalDuration / 60).toFixed(1)} min)`);
  console.log('═══════════════════════════════════════════════════════');
}

// ══════════════════════════════════════════════════════════════
// MODULE-LEVEL — crawlStartTime used inside requestHandler
// for progress logging elapsed time
// ══════════════════════════════════════════════════════════════
let crawlStartTime = Date.now();

// ══════════════════════════════════════════════════════════════
// RUN
// ══════════════════════════════════════════════════════════════
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
