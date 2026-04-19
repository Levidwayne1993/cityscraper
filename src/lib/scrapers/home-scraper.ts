// ============================================================
// FILE: src/lib/scrapers/home-scraper.ts (REPLACES EXISTING)
// CHEAP HOME SCRAPER v3.0 — Powers CheapHouseHub.com
//
// COMPLETE UPDATE: All 7 data pillars integrated
//
// v3.0 CHANGES (April 2026):
// - RE-ENABLED HomePath (Fannie Mae) via hidden REST API
// - ADDED Realtor.com via RapidAPI (free tier, 100 calls/mo)
// - RE-ENABLED Auction.com, Xome (attempt scrape, graceful fail)
// - RE-ENABLED FSBO.com scraper
// - RE-ENABLED RealtyMole + RentCast (if API keys set)
// - ADDED 'realtor-api' source config + 'api' category
// - Enrichment pipeline hooks (Pillars 3-7) ready for Section 2+
// ============================================================
import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '@/lib/supabase';
import PQueue from 'p-queue';

// Import source modules
import { scrapeGovernmentSources } from './home-sources/government';
import { scrapeAuctionREOSources } from './home-sources/auction-reo';
import { scrapePortalSources } from './home-sources/portals';
import { scrapeCountySources } from './home-sources/county';
import { scrapeOtherSources } from './home-sources/other';

// ============================================================
// SHARED TYPES & CONFIG — exported for all source modules
// ============================================================
export interface CheapHomeItem {
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string | null;
  price: number;
  original_price: number | null;
  starting_bid: number | null;
  assessed_value: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_size: string | null;
  year_built: number | null;
  property_type: string;
  listing_type: string;
  listing_category: string;
  source: string;
  source_url: string;
  image_urls: string[];
  description: string | null;
  auction_date: string | null;
  case_number: string | null;
  parcel_id: string | null;
  property_status: string | null;
  lat: number | null;
  lng: number | null;
}

export const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

export const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

// Shared rate-limited queue for all HTTP requests
export const httpQueue = new PQueue({ concurrency: 3, interval: 1200, intervalCap: 3 });

export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

export function getRandomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ============================================================
// SHARED UTILITIES — exported for all source modules
// ============================================================
export function parsePrice(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

export function extractCity(address: string): string {
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 3) return parts[parts.length - 3] || parts[0] || 'Unknown';
  if (parts.length >= 2) return parts[parts.length - 2] || parts[0] || 'Unknown';
  return parts[0] || 'Unknown';
}

export function extractZip(address: string): string {
  const match = address.match(/\b(\d{5})(-\d{4})?\b/);
  return match ? match[1] : '';
}

export function extractStateFromAddress(address: string): string {
  const statePattern = /\b([A-Z]{2})\s+\d{5}\b/;
  const match = address.match(statePattern);
  return match ? match[1] : '';
}

export function cleanTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim().substring(0, 200);
}

export function isValidAddress(address: string): boolean {
  const trimmed = address.trim();
  return trimmed.length > 10 && /\d/.test(trimmed);
}

export function detectPropertyType(text: string): string {
  const lower = (text || '').toLowerCase();
  if (lower.includes('condo')) return 'condo';
  if (lower.includes('townho') || lower.includes('town ho')) return 'townhome';
  if (lower.includes('multi') || lower.includes('duplex') || lower.includes('triplex') || lower.includes('fourplex')) return 'multi-family';
  if (lower.includes('mobile') || lower.includes('manufactured')) return 'mobile';
  if (lower.includes('land') || lower.includes('lot') || lower.includes('vacant')) return 'land';
  if (lower.includes('commercial')) return 'commercial';
  return 'single-family';
}

export function detectListingType(text: string): string {
  const lower = (text || '').toLowerCase();
  if (lower.includes('foreclos')) return 'foreclosure';
  if (lower.includes('pre-foreclos') || lower.includes('preforeclos')) return 'pre-foreclosure';
  if (lower.includes('auction')) return 'auction';
  if (lower.includes('short sale') || lower.includes('short-sale')) return 'short-sale';
  if (lower.includes('tax lien')) return 'tax-lien';
  if (lower.includes('tax deed')) return 'tax-deed';
  if (lower.includes('sheriff')) return 'sheriff-sale';
  if (lower.includes('reo') || lower.includes('bank own') || lower.includes('bank-own')) return 'reo';
  if (lower.includes('hud')) return 'hud';
  if (lower.includes('fsbo') || lower.includes('by owner')) return 'fsbo';
  return 'cheap';
}

export function generateDedupeKey(item: CheapHomeItem): string {
  return `${item.address.toLowerCase().replace(/[^a-z0-9]/g, '')}-${item.zip}-${item.source}`;
}

// ============================================================
// SOURCE CONFIGURATION — v3.0
// RE-ENABLED: homepath, auction-com, xome, fsbo, realtor-com, realtymole, rentcast
// NEW: realtor-api (RapidAPI)
// ============================================================
export interface SourceConfig {
  enabled: boolean;
  label: string;
  category: string;
  requiresApiKey?: string;
  isPaid?: boolean;
}

export const SOURCE_CONFIG: Record<string, SourceConfig> = {
  // === GOVERNMENT / FEDERAL ===
  'hud-homestore':        { enabled: true,  label: 'HUD HomeStore',               category: 'government' },
  'homepath':             { enabled: true,  label: 'Fannie Mae HomePath',          category: 'government' },    // RE-ENABLED: REST API bypass
  'usda':                 { enabled: true,  label: 'USDA RD/FSA',                 category: 'government' },
  'homesteps':            { enabled: false, label: 'Freddie Mac HomeSteps',        category: 'government' },    // Program discontinued

  // === AUCTION PLATFORMS ===
  'auction-com':          { enabled: true,  label: 'Auction.com',                  category: 'auction' },       // RE-ENABLED: attempt scrape
  'hubzu':                { enabled: false, label: 'Hubzu',                        category: 'auction' },       // Still dead
  'xome':                 { enabled: true,  label: 'Xome Auctions',               category: 'auction' },       // RE-ENABLED: attempt scrape

  // === BANK-OWNED / REO ===
  'bank-reo':             { enabled: false, label: 'Bank REO Aggregator',          category: 'reo' },

  // === REAL ESTATE PORTALS ===
  'zillow':               { enabled: true,  label: 'Zillow Foreclosures',          category: 'portal' },
  'realtor-com':          { enabled: false, label: 'Realtor.com Direct Scrape',    category: 'portal' },        // Replaced by API
  'realtor-api':          { enabled: true,  label: 'Realtor.com API (RapidAPI)',   category: 'portal', requiresApiKey: 'RAPIDAPI_KEY' },  // NEW
  'redfin':               { enabled: true,  label: 'Redfin Distressed',            category: 'portal' },

  // === COUNTY-LEVEL PUBLIC RECORDS ===
  'county-sheriff':       { enabled: false, label: 'County Sheriff Sales',         category: 'county' },        // Section 2
  'county-tax':           { enabled: false, label: 'Tax Lien/Deed Sales',          category: 'county' },        // Section 2
  'county-foreclosure':   { enabled: false, label: 'County Foreclosures',          category: 'county' },        // Section 2

  // === FSBO & OTHER ===
  'craigslist':           { enabled: true,  label: 'Craigslist Housing',           category: 'other' },
  'fsbo':                 { enabled: true,  label: 'ForSaleByOwner.com',           category: 'other' },         // RE-ENABLED

  // === API-BASED (require keys) ===
  'realtymole':           { enabled: true,  label: 'RealtyMole API',              category: 'api', requiresApiKey: 'REALTY_MOLE_API_KEY' },    // RE-ENABLED
  'rentcast':             { enabled: true,  label: 'RentCast API',                category: 'api', requiresApiKey: 'RENTCAST_API_KEY' },        // RE-ENABLED

  // === PAID DATA PROVIDERS ===
  'foreclosure-com':      { enabled: false, label: 'Foreclosure.com',             category: 'paid', isPaid: true, requiresApiKey: 'FORECLOSURE_COM_KEY' },
  'foreclosure-datahub':  { enabled: false, label: 'Foreclosure Data Hub',        category: 'paid', isPaid: true, requiresApiKey: 'FORECLOSURE_DATAHUB_KEY' },
  'propertyshark':        { enabled: false, label: 'PropertyShark',               category: 'paid', isPaid: true, requiresApiKey: 'PROPERTYSHARK_KEY' },
};

export function isSourceEnabled(sourceId: string): boolean {
  const config = SOURCE_CONFIG[sourceId];
  if (!config || !config.enabled) return false;
  if (config.requiresApiKey && !process.env[config.requiresApiKey]) return false;
  return true;
}

// ============================================================
// STATE ROTATION — scrape 10 states per run (all 50 in 5 days)
// ============================================================
function getStateBatch(): { states: string[]; batchIndex: number; totalBatches: number } {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86400000);
  const totalBatches = 5;
  const batchIndex = dayOfYear % totalBatches;
  const batchSize = 10;
  const start = batchIndex * batchSize;
  const states = ALL_STATES.slice(start, start + batchSize);
  return { states, batchIndex, totalBatches };
}

// ============================================================
// MAIN SCRAPE ORCHESTRATOR
// ============================================================
export async function scrapeCheapHomes(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  const startTime = Date.now();
  const DEADLINE_MS = 250_000;

  function isTimedOut(): boolean {
    return Date.now() - startTime > DEADLINE_MS;
  }

  const { states: stateBatch, batchIndex, totalBatches } = getStateBatch();

  console.log('[Homes] ========== CHEAP HOME SCRAPER v3.0 ==========');
  console.log(`[Homes] State batch ${batchIndex + 1}/${totalBatches}: ${stateBatch.join(', ')}`);
  console.log('[Homes] Starting multi-source scrape...');

  const enabledSources = Object.entries(SOURCE_CONFIG)
    .filter(([id]) => isSourceEnabled(id))
    .map(([id, cfg]) => `${cfg.label}`)
    .join(', ');
  console.log(`[Homes] Active sources: ${enabledSources}`);

  let totalItems = 0;
  let totalErrors = 0;
  const sourceResults: Record<string, { items: number; errors: number; time: number }> = {};

  async function runSourceCategory(
    categoryName: string,
    scrapeFn: (states: string[], isTimedOut: () => boolean) => Promise<CheapHomeItem[]>
  ): Promise<void> {
    if (isTimedOut()) {
      console.log(`[Homes] TIMEOUT — skipping ${categoryName}`);
      return;
    }

    const catStart = Date.now();
    console.log(`[Homes] --- Starting ${categoryName} ---`);

    try {
      const items = await scrapeFn(stateBatch, isTimedOut);
      const rawCount = items.length;
      const validItems = items.filter(item =>
        item.address && item.price >= 0 && isValidAddress(item.address)
      );

      const rejected = rawCount - validItems.length;
      if (rejected > 0) {
        console.log(`[Homes] ${categoryName}: ${rejected} items failed validation`);
      }

      if (validItems.length > 0) {
        const saved = await saveItems(validItems);
        totalItems += saved;
        sourceResults[categoryName] = { items: saved, errors: 0, time: Date.now() - catStart };
        console.log(`[Homes] ${categoryName}: saved ${saved}/${validItems.length} valid items (${((Date.now() - catStart)/1000).toFixed(1)}s)`);
      } else {
        sourceResults[categoryName] = { items: 0, errors: 0, time: Date.now() - catStart };
        console.log(`[Homes] ${categoryName}: 0 valid items (${((Date.now() - catStart)/1000).toFixed(1)}s)`);
      }
    } catch (err: any) {
      totalErrors++;
      sourceResults[categoryName] = { items: 0, errors: 1, time: Date.now() - catStart };
      console.error(`[Homes] ${categoryName} FAILED: ${err.message}`);
    }
  }

  function isCategoryActive(category: string): boolean {
    return Object.entries(SOURCE_CONFIG).some(
      ([id, cfg]) => cfg.category === category && isSourceEnabled(id)
    );
  }

  // 1. Government sources — highest priority
  if (isCategoryActive('government')) {
    await runSourceCategory('Government', scrapeGovernmentSources);
  } else {
    console.log('[Homes] Skipping Government — all sources disabled');
  }

  // 2. Auction & REO
  if (isCategoryActive('auction') || isCategoryActive('reo') || isCategoryActive('api')) {
    await runSourceCategory('Auction/REO', scrapeAuctionREOSources);
  } else {
    console.log('[Homes] Skipping Auction/REO — all sources disabled');
  }

  // 3. County public records
  if (isCategoryActive('county')) {
    await runSourceCategory('County', scrapeCountySources);
  } else {
    console.log('[Homes] Skipping County — all sources disabled');
  }

  // 4. Portal distressed listings
  if (isCategoryActive('portal')) {
    await runSourceCategory('Portals', scrapePortalSources);
  } else {
    console.log('[Homes] Skipping Portals — all sources disabled');
  }

  // 5. FSBO, Craigslist, other
  if (isCategoryActive('other')) {
    await runSourceCategory('Other', scrapeOtherSources);
  } else {
    console.log('[Homes] Skipping Other — all sources disabled');
  }

  const duration = Date.now() - startTime;
  const details = Object.entries(sourceResults)
    .map(([cat, r]) => `${cat}:${r.items}`)
    .join(' | ');

  console.log(`[Homes] ========== SCRAPE COMPLETE ==========`);
  console.log(`[Homes] Total: ${totalItems} items, ${totalErrors} errors, ${(duration/1000).toFixed(1)}s`);
  console.log(`[Homes] Breakdown: ${details}`);

  return {
    success: totalErrors === 0,
    itemsFound: totalItems,
    errors: totalErrors,
    details: `Batch ${batchIndex + 1}/${totalBatches} (${stateBatch.join(',')}), ${totalItems} cheap homes in ${(duration / 1000).toFixed(1)}s | ${details}`,
  };
}

// ============================================================
// DATABASE SAVE (with deduplication & batch upsert)
// ============================================================
async function saveItems(items: CheapHomeItem[]): Promise<number> {
  const seen = new Set<string>();
  const uniqueItems = items.filter((item) => {
    const key = generateDedupeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let savedCount = 0;
  const batchSize = 100;

  for (let i = 0; i < uniqueItems.length; i += batchSize) {
    const batch = uniqueItems.slice(i, i + batchSize).map((item) => ({
      title: cleanTitle(item.title),
      address: item.address,
      city: item.city,
      state: item.state,
      zip: item.zip,
      county: item.county,
      price: item.price,
      original_price: item.original_price,
      starting_bid: item.starting_bid,
      assessed_value: item.assessed_value,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
      sqft: item.sqft,
      lot_size: item.lot_size,
      year_built: item.year_built,
      property_type: item.property_type,
      listing_type: item.listing_type,
      listing_category: item.listing_category,
      source: item.source,
      source_url: item.source_url,
      image_urls: item.image_urls,
      description: item.description?.substring(0, 2000) || null,
      auction_date: item.auction_date,
      case_number: item.case_number,
      parcel_id: item.parcel_id,
      property_status: item.property_status || 'active',
      lat: item.lat,
      lng: item.lng,
      scraped_at: new Date().toISOString(),
      pushed: false,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }));

    const { error } = await supabaseAdmin
      .from('cheap_homes')
      .upsert(batch, { onConflict: 'source_url' });

    if (error) {
      console.error(`[Homes] Upsert batch error:`, error.message);
    } else {
      savedCount += batch.length;
    }
  }

  return savedCount;
}
