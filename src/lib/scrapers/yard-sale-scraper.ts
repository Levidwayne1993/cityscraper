// ============================================================
// FILE: src/lib/scrapers/yard-sale-scraper.ts (CityScraper project)
// REPLACE the entire file
//
// CHANGES:
// 1. Added ScraperAPI proxy support via SCRAPER_API_KEY env var
// 2. Craigslist + EstateSales.net now route through ScraperAPI
// 3. Falls back to direct fetch if no API key is set
// 4. Keeps all existing logic: 50-state coverage, warm container
//    fix, address hard gate, save-as-you-go architecture
//
// ENV VAR REQUIRED: SCRAPER_API_KEY (optional — falls back to direct)
// ============================================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '@/lib/supabase';
import {
  type RawListing,
  type NormalizedSale,
  normalizeListing,
  extractAddress,
  extractCity,
  generateSourceId,
} from './yard-sale-normalizer';

// ================================================================
//  YARD SALE SCRAPER v5.0 — SCRAPERAPI PROXY EDITION
//
//  WHAT'S NEW:
//  - ScraperAPI proxy for Craigslist + EstateSales.net
//  - Falls back to direct fetch if SCRAPER_API_KEY not set
//  - Warm container fix preserved from v4.1
//
//  Sources: Craigslist (175+ cities), EstateSales.net (50 states)
//
//  HARD GATE: Every listing MUST have a real street address
//  starting with a number. No address = rejected.
// ================================================================

const DEADLINE_MS = 55000;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
];

function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function isTimedOut(startTime: number): boolean {
  return Date.now() - startTime > DEADLINE_MS;
}

// ── ScraperAPI Helper ──

function getScraperApiKey(): string | null {
  return process.env.SCRAPER_API_KEY || null;
}

/**
 * Fetch a URL through ScraperAPI proxy, or fall back to direct axios.
 * Returns HTML string or null on failure.
 */
async function smartFetch(url: string): Promise<string | null> {
  const apiKey = getScraperApiKey();

  try {
    if (apiKey) {
      // Route through ScraperAPI — bypasses IP blocks
      const proxyUrl = `http://api.scraperapi.com?api_key=${apiKey}&url=${encodeURIComponent(url)}&render=false`;
      const response = await axios.get(proxyUrl, {
        timeout: 25000,
        maxRedirects: 3,
      });
      return response.data;
    } else {
      // Direct fetch (original behavior)
      return await safeFetch(url);
    }
  } catch (err) {
    // If ScraperAPI fails, try direct as last resort
    if (apiKey) {
      console.warn(`[ScraperAPI] Failed for ${url}, trying direct...`);
      return await safeFetch(url);
    }
    return null;
  }
}

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const CRAIGSLIST_CITIES: Record<string, string[]> = {
  AL: ['birmingham','huntsville','mobile','montgomery'],
  AK: ['anchorage','fairbanks'],
  AZ: ['phoenix','tucson','flagstaff'],
  AR: ['littlerock','fayar','fortsmith'],
  CA: ['losangeles','sfbay','sandiego','sacramento','fresno','inlandempire','orangecounty'],
  CO: ['denver','coloradosprings','boulder','fortcollins'],
  CT: ['hartford','newhaven'],
  DE: ['delaware'],
  FL: ['miami','tampa','orlando','jacksonville','fortlauderdale','sarasota'],
  GA: ['atlanta','savannah','augusta','macon'],
  HI: ['honolulu'],
  ID: ['boise','eastidaho'],
  IL: ['chicago','springfieldil','peoria','chambana'],
  IN: ['indianapolis','fortwayne','southbend'],
  IA: ['desmoines','cedarrapids','quadcities'],
  KS: ['kansascity','wichita','topeka'],
  KY: ['louisville','lexington'],
  LA: ['neworleans','batonrouge','shreveport','lafayette'],
  ME: ['maine'],
  MD: ['baltimore','frederick','easternshore'],
  MA: ['boston','worcester','westernmass'],
  MI: ['detroit','grandrapids','annarbor','lansing','flint'],
  MN: ['minneapolis','duluth','stcloud'],
  MS: ['jackson','gulfport','hattiesburg'],
  MO: ['stlouis','kansascity','springfield','columbiamo'],
  MT: ['billings','missoula','greatfalls','helena'],
  NE: ['omaha','lincoln'],
  NV: ['lasvegas','reno'],
  NH: ['nh'],
  NJ: ['newjersey','jerseyshore','southjersey'],
  NM: ['albuquerque','santafe','lascruces'],
  NY: ['newyork','albany','buffalo','rochester','syracuse','longisland','hudsonvalley'],
  NC: ['charlotte','raleigh','greensboro','asheville','wilmington'],
  ND: ['fargo','bismarck'],
  OH: ['cleveland','columbus','cincinnati','dayton','toledo','akroncanton'],
  OK: ['oklahomacity','tulsa'],
  OR: ['portland','eugene','salem','bend','medford'],
  PA: ['philadelphia','pittsburgh','harrisburg','allentown','erie'],
  RI: ['providence'],
  SC: ['charleston','columbia','greenville','myrtlebeach'],
  SD: ['siouxfalls','rapidcity'],
  TN: ['nashville','memphis','knoxville','chattanooga'],
  TX: ['houston','dallas','austin','sanantonio','fortworth','elpaso'],
  UT: ['saltlakecity','provo','ogden'],
  VT: ['burlington'],
  VA: ['norfolk','richmond','roanoke','charlottesville'],
  WA: ['seattle','olympia','tacoma','spokane','bellingham'],
  WV: ['charlestonwv','morgantown','huntington'],
  WI: ['milwaukee','madison','greenbay','appleton'],
  WY: ['wyoming'],
};

// ── Safe HTTP GET (direct, no proxy — used as fallback) ──

async function safeFetch(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': getRandomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 8000,
      maxRedirects: 3,
    });
    return response.data;
  } catch {
    return null;
  }
}

// ── CRAIGSLIST (now through ScraperAPI) ──

async function scrapeCraigslistCity(city: string, state: string): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const url = `https://${city}.craigslist.org/search/gms`;

  // Use ScraperAPI if available, otherwise direct (will likely be blocked)
  const html = await smartFetch(url);
  if (!html) return listings;

  const $ = cheerio.load(html);

  $('li.cl-static-search-result, .result-row, .cl-search-result').each((_, el) => {
    const titleEl = $(el).find('.title, .result-title, .titlestring, .posting-title .label');
    const title = titleEl.text().trim();
    if (!title) return;

    const linkEl = titleEl.closest('a').length ? titleEl.closest('a') : $(el).find('a').first();
    const link = linkEl.attr('href') || '';
    const fullLink = link.startsWith('http') ? link : `https://${city}.craigslist.org${link}`;

    const metaEl = $(el).find('.meta, .result-meta');
    const dateText = metaEl.find('time, .date, .datetime').attr('datetime')
      || metaEl.find('time, .date, .datetime').text().trim()
      || $(el).find('time').attr('datetime') || '';

    const locationText = $(el).find('.location, .result-hood, .subreddit').text().trim().replace(/[()]/g, '');
    const priceText = $(el).find('.price, .result-price, .priceinfo').text().trim();
    const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

    listings.push({
      title,
      description: locationText,
      address: locationText,
      city: city.replace(/[^a-zA-Z]/g, ' ').trim(),
      state,
      date: dateText,
      time: '',
      sourceUrl: fullLink,
      sourceName: 'craigslist',
      sourceCategory: 'craigslist',
      price: priceText || undefined,
      photos: imgSrc ? [imgSrc] : [],
    });
  });

  return listings;
}

// ── ESTATESALES.NET (now through ScraperAPI) ──

async function scrapeEstateSales(state: string): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const url = `https://www.estatesales.net/${state}`;

  // Use ScraperAPI if available
  const html = await smartFetch(url);
  if (!html) return listings;

  const $ = cheerio.load(html);

  $('.sale-item, .saleCard, .listing-card, [class*="sale-card"], [class*="saleItem"]').each((_, el) => {
    const title = $(el).find('.sale-title, h3, h2, .title').first().text().trim();
    const company = $(el).find('.company-name, .hosted-by, .sale-company').first().text().trim();
    const address = $(el).find('.address, .sale-location, .sale-address, .location').first().text().trim();
    const dateText = $(el).find('.sale-dates, .dates, .sale-date, time').first().text().trim();

    const link = $(el).find('a').first().attr('href') || '';
    const fullLink = link.startsWith('http') ? link : `https://www.estatesales.net${link}`;
    const imgSrc = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';

    const fullTitle = title ? `Estate Sale: ${title}` : '';
    const fullDesc = [
      company ? `Hosted by ${company}` : '',
      dateText ? `Dates: ${dateText}` : '',
    ].filter(Boolean).join(' | ');

    listings.push({
      title: fullTitle,
      description: fullDesc,
      address,
      city: extractCity(address) || undefined,
      state,
      date: dateText,
      time: dateText,
      sourceUrl: fullLink,
      sourceName: 'estatesales.net',
      sourceCategory: 'estate-sale',
      photos: imgSrc ? [imgSrc] : [],
    });
  });

  return listings;
}

// ── Normalize + dedup a batch ──

function normalizeBatch(rawListings: RawListing[], seenIds: Set<string>): NormalizedSale[] {
  const results: NormalizedSale[] = [];
  for (const raw of rawListings) {
    const sale = normalizeListing(raw);
    if (!sale) continue;
    if (seenIds.has(sale.source_id)) continue;
    seenIds.add(sale.source_id);
    results.push(sale);
  }
  return results;
}

// ── Supabase row mapper ──

function toSupabaseRow(sale: NormalizedSale) {
  return {
    source_id: sale.source_id,
    title: sale.title,
    description: sale.description || '',
    address: sale.address || '',
    city: sale.city || '',
    state: sale.state || '',
    zip: sale.zip || '',
    lat: sale.latitude,
    lng: sale.longitude,
    date_start: sale.sale_date || new Date().toISOString().split('T')[0],
    date_end: null,
    time_start: sale.sale_time_start,
    time_end: sale.sale_time_end,
    price_range: sale.price,
    categories: sale.categories,
    source: sale.source,
    source_url: sale.source_url,
    image_urls: sale.photo_urls,
    expires_at: sale.expires_at,
    scraped_at: sale.collected_at,
    pushed: false,
  };
}

// ── Save batch to Supabase ──

async function saveBatch(sales: NormalizedSale[]): Promise<{ saved: number; errors: number }> {
  if (sales.length === 0) return { saved: 0, errors: 0 };
  let saved = 0;
  let errors = 0;
  const batchSize = 50;

  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize).map(toSupabaseRow);
    const { error } = await supabaseAdmin
      .from('yard_sales')
      .upsert(batch, { onConflict: 'source_url' });

    if (error) {
      console.error(`[YardSale] Upsert error: ${error.message}`);
      errors++;
    } else {
      saved += batch.length;
    }
  }

  return { saved, errors };
}

// ══════════════════════════════════════════════
//  MAIN EXPORT — SAVE-AS-YOU-GO ARCHITECTURE
// ══════════════════════════════════════════════

export async function scrapeYardSales(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  const startTime = Date.now();
  const hasProxy = !!getScraperApiKey();

  console.log('[YardSale] ═══════════════════════════════════════════');
  console.log('[YardSale] SCRAPER v5.0 — SCRAPERAPI PROXY EDITION');
  console.log(`[YardSale] ScraperAPI: ${hasProxy ? 'ENABLED' : 'DISABLED (no key)'}`);
  console.log('[YardSale] Address hard gate ACTIVE');
  console.log('[YardSale] Deadline: 55s | Saves after EVERY state');
  console.log('[YardSale] ═══════════════════════════════════════════');

  let totalSaved = 0;
  let totalErrors = 0;
  let totalRaw = 0;
  let statesCompleted = 0;
  const seenIds = new Set<string>();

  for (const state of ALL_STATES) {
    if (isTimedOut(startTime)) {
      console.log(`[YardSale] Deadline hit at ${statesCompleted} states. Saving what we have.`);
      break;
    }

    const stateRaw: RawListing[] = [];

    // Craigslist cities for this state
    const cities = CRAIGSLIST_CITIES[state] || [];
    for (const city of cities) {
      if (isTimedOut(startTime)) break;
      try {
        const items = await scrapeCraigslistCity(city, state);
        if (items.length > 0) stateRaw.push(...items);
      } catch {
        totalErrors++;
      }
    }

    // EstateSales.net for this state
    if (!isTimedOut(startTime)) {
      try {
        const items = await scrapeEstateSales(state);
        if (items.length > 0) stateRaw.push(...items);
      } catch {
        totalErrors++;
      }
    }

    totalRaw += stateRaw.length;

    // Normalize + save immediately
    const valid = normalizeBatch(stateRaw, seenIds);
    if (valid.length > 0) {
      const result = await saveBatch(valid);
      totalSaved += result.saved;
      totalErrors += result.errors;
      console.log(`[YardSale] ${state}: ${stateRaw.length} raw -> ${valid.length} valid -> ${result.saved} saved`);
    } else {
      console.log(`[YardSale] ${state}: ${stateRaw.length} raw -> 0 valid (no addresses)`);
    }

    statesCompleted++;
  }

  const duration = Date.now() - startTime;

  console.log('[YardSale] ═══════════════════════════════════════════');
  console.log(`[YardSale] DONE: ${statesCompleted}/50 states`);
  console.log(`[YardSale] Raw: ${totalRaw} -> Saved: ${totalSaved} -> Errors: ${totalErrors}`);
  console.log(`[YardSale] Proxy: ${hasProxy ? 'ScraperAPI' : 'Direct (no key)'}`);
  console.log(`[YardSale] Time: ${(duration / 1000).toFixed(1)}s`);
  console.log('[YardSale] ═══════════════════════════════════════════');

  return {
    success: totalErrors === 0,
    itemsFound: totalSaved,
    errors: totalErrors,
    details: `${statesCompleted}/50 states | Raw: ${totalRaw} -> Saved: ${totalSaved} | Proxy: ${hasProxy ? 'YES' : 'NO'} | ${(duration / 1000).toFixed(1)}s`,
  };
}
