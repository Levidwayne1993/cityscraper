// ============================================================
// PASTE INTO: src/lib/scrapers/yard-sale-normalizer.ts (cityscraper project)
//
// FIXES:
// 1. parseDate() now handles M-D-YYYY hyphen format (e.g. "4-17-2026")
// 2. DATE_PATTERNS includes hyphen dates so extractDates() catches them
// 3. normalizeListing() checks TITLE dates FIRST, then description,
//    then raw.date — so the actual sale date from the seller's title
//    takes priority over CL's posting date
// ============================================================

import { createHash } from 'crypto';

// ================================================================
//  YARD SALE NORMALIZER v3.1 — DATE PRIORITY FIX
//  Combines: YardShoppers collector (465 lines) + CityScraper draft
//  
//  HARD GATE: Every listing MUST have a real street address
//  starting with a number (e.g. "2607 11th Ave SW Olympia WA 98512")
//  No address = no listing. Period.
//
//  Self-contained — no external dependencies except 'crypto'
// ================================================================

// ============================================
// TYPES (from YardShoppers types.ts)
// ============================================

export type SourceCategory =
  | 'craigslist'
  | 'facebook'
  | 'offerup'
  | 'reddit'
  | 'nextdoor'
  | 'yardsale-directory'
  | 'estate-sale'
  | 'newspaper'
  | 'community-board'
  | 'marketplace'
  | 'hyperlocal'
  | 'tv-station'
  | 'public-radio';

export interface RawListing {
  title?: string;
  description?: string;
  date?: string;
  time?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  photos?: string[];
  latitude?: number;
  longitude?: number;
  sourceUrl: string;
  sourceName: string;
  sourceCategory?: SourceCategory;
  price?: string;
  rawHtml?: string;
}

export interface NormalizedSale {
  source: string;
  source_id: string;
  source_url: string;
  title: string;
  description: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  price: string | null;
  sale_date: string | null;
  sale_time_start: string | null;
  sale_time_end: string | null;
  category: string | null;
  categories: string[];
  photo_urls: string[];
  address: string | null;
  zip: string | null;
  expires_at: string | null;
  collected_at: string;
}

// ============================================
// KEYWORD DETECTION (from YardShoppers keywords.ts)
// ============================================

export const PRIMARY_KEYWORDS: string[] = [
  'yard sale', 'garage sale', 'estate sale', 'moving sale',
  'rummage sale', 'tag sale', 'community sale', 'neighborhood sale',
  'multi-family sale', 'multi family sale', 'block sale',
  'church sale', 'flea market', 'swap meet',
];

export const SECONDARY_KEYWORDS: string[] = [
  'classifieds', 'events', 'community events', 'local events',
  'calendar', 'weekend', 'for sale', 'marketplace',
  'buy sell trade', 'liquidation', 'downsizing',
];

// ============================================
// ADDRESS / ZIP / DATE / TIME PATTERNS
// ============================================

export const ADDRESS_PATTERN =
  /\d{1,5}\s+(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+)?(?:[A-Za-z0-9]+\s+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace|Hwy|Highway|Trail|Trl|Loop|Run|Pass|Path|Pike|Sq|Square)\b/i;

export const ZIP_PATTERN = /\b\d{5}(-\d{4})?\b/;

// FIX: Added M-D-YYYY hyphen format pattern
export const DATE_PATTERNS: RegExp[] = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(day)?\b/i,
];

export const TIME_PATTERNS: RegExp[] = [
  /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|AM|PM)\b/,
  /\b\d{1,2}(:\d{2})?\s*[-\u2013\u2014to]+\s*\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|AM|PM)\b/,
];

// ============================================
// JUNK TITLE FILTER (YardShoppers 65+ exact matches)
// ============================================

const JUNK_TITLES_EXACT = new Set([
  // Yard sale site navigation
  'find yard sales', 'find garage sales', 'find estate sales',
  'find garage sales by map', 'find garage sales by city and state',
  'find garage sales by zip code', 'find yard sales by map',
  'find yard sales by city and state', 'find yard sales by zip code',
  'post a yard sale', 'post a garage sale',
  'post your yard sale', 'post your garage sale',
  'list your garage sale', 'list your yard sale',
  'list your garage sale for free', 'list your yard sale for free',
  'garage sale tips', 'yard sale tips', 'estate sale tips',
  'garage sale guide', 'yard sale guide',
  'how to have a garage sale', 'how to have a yard sale',
  'garage sale pricing guide', 'yard sale pricing guide',
  // Generic site navigation
  'about us', 'contact us', 'privacy policy',
  'terms of service', 'terms and conditions',
  'sign up', 'sign in', 'log in', 'login', 'register',
  'create account', 'my account', 'my listings', 'my sales',
  'advertise with us', 'advertise', 'faq', 'help', 'blog',
  'home', 'search',
  // Alert/subscribe elements
  'alert me about new yard sales in this area!',
  'alert me about new yard sales in this area',
  'alert me about new garage sales in this area',
  'get alerts', 'set alerts', 'subscribe', 'newsletter',
  'download our app', 'get the app', 'mobile app',
  // Generic non-listing titles
  '', 'n/a', 'na', 'none', 'no title', 'untitled',
  'test', 'testing', 'asdf', 'null', 'undefined',
  'click here', 'read more', 'learn more', 'see details',
  'view details', 'more info', 'info', 'details',
  'sale', 'event', 'listing', 'post', 'ad',
]);

const JUNK_PATTERNS: RegExp[] = [
  // Yard-sale site navigation (from YardShoppers)
  /^find\s+(yard|garage|estate)\s+sales?\b/i,
  /^post\s+(a|your)\s+(yard|garage|estate)\s+sale/i,
  /^list\s+your\s+(yard|garage|estate)\s+sale/i,
  /^(yard|garage|estate)\s+sale\s+(tips|guide|advice|help)/i,
  /^how\s+to\s+(have|run|organize|host)\s+a/i,
  // Generic site navigation
  /^(about|contact|privacy|terms|faq|help|blog|home|search)$/i,
  /^(sign|log)\s*(up|in|out)$/i,
  /^(create|my)\s+(account|listings?|sales?)$/i,
  /^alert\s+me\b/i,
  /^subscribe\b/i,
  /^get\s+(alerts?|the\s+app|started)/i,
  /^download\b/i,
  /^advertise\b/i,
  /^pricing\s+(guide|tips)/i,
  // Pagination & UI elements
  /^view\s+all\b/i,
  /^see\s+(all|more)\b/i,
  /^load\s+more\b/i,
  /^show\s+more\b/i,
  /^read\s+more\b/i,
  /^learn\s+more\b/i,
  /^click\s+here\b/i,
  /^more\s+info\b/i,
  /^back\s+to\b/i,
  /^go\s+to\b/i,
  /^next\s+page\b/i,
  /^previous\s+page\b/i,
  /^\d+$/,
  // Spam patterns
  /^[\W\d\s]+$/,
  /^.{300,}$/,
  /^https?:\/\//i,
  /\b(viagra|cialis|casino|poker|lottery|winner|prize)\b/i,
  /\b(diet pill|weight loss|make money|work from home|earn \$)\b/i,
  /\b(obituary|obituaries|death notice|memorial)\b/i,
  /\b(unsubscribe|opt.out|manage preferences)\b/i,
  /\b(sponsored|promoted|advertisement|paid content)\b/i,
  /\b(coupon|promo code|discount code|voucher)\b/i,
  /^\s*re:\s/i,
  /^\s*fw:\s/i,
];

export function isJunkTitle(title: string): boolean {
  if (!title) return true;
  const normalized = title.toLowerCase().trim();

  if (JUNK_TITLES_EXACT.has(normalized)) return true;

  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }

  // Too short — probably a button label
  if (normalized.length < 8) return true;

  // All caps + short + no numbers = nav button (YardShoppers logic)
  if (title === title.toUpperCase() && normalized.length < 30) {
    if (!/\d/.test(title)) return true;
  }

  return false;
}

// ============================================
// CATEGORY DETECTION (18 sale types + 6 content types)
// ============================================

const CATEGORY_PATTERNS: { pattern: RegExp; category: string }[] = [
  // Sale types (YardShoppers — proper casing)
  { pattern: /estate\s*sale/i, category: 'Estate Sale' },
  { pattern: /garage\s*sale/i, category: 'Garage Sale' },
  { pattern: /yard\s*sale/i, category: 'Yard Sale' },
  { pattern: /moving\s*sale/i, category: 'Moving Sale' },
  { pattern: /rummage\s*sale/i, category: 'Rummage Sale' },
  { pattern: /tag\s*sale/i, category: 'Tag Sale' },
  { pattern: /church\s*sale/i, category: 'Church Sale' },
  { pattern: /community\s*sale/i, category: 'Community Sale' },
  { pattern: /neighborhood\s*sale/i, category: 'Neighborhood Sale' },
  { pattern: /multi[\s-]*family\s*sale/i, category: 'Multi-Family Sale' },
  { pattern: /block\s*sale/i, category: 'Block Sale' },
  { pattern: /flea\s*market/i, category: 'Flea Market' },
  { pattern: /swap\s*meet/i, category: 'Swap Meet' },
  { pattern: /liquidation/i, category: 'Liquidation Sale' },
  { pattern: /downsizing/i, category: 'Downsizing Sale' },
  { pattern: /barn\s*sale/i, category: 'Barn Sale' },
  { pattern: /storage\s*sale/i, category: 'Storage Sale' },
  { pattern: /clearance/i, category: 'Clearance Sale' },
  // Content types (helps users filter)
  { pattern: /\b(furniture|couch|sofa|table|chair|desk|dresser|bed|mattress)\b/i, category: 'Furniture' },
  { pattern: /\b(electronics?|tv|computer|laptop|phone|speaker|gaming|console)\b/i, category: 'Electronics' },
  { pattern: /\b(clothing|clothes|shoes|jacket|dress|shirt|pants)\b/i, category: 'Clothing' },
  { pattern: /\b(tools?|drill|saw|wrench|hammer|power\s*tool|workshop)\b/i, category: 'Tools' },
  { pattern: /\b(kids?|toys?|baby|children|stroller|crib|toddler)\b/i, category: 'Kids & Toys' },
  { pattern: /\b(antiques?|vintage|collectible|retro|mid.century)\b/i, category: 'Antiques & Vintage' },
];

export function guessCategory(text: string): string {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return 'Garage Sale';
}

export function guessCategories(text: string): string[] {
  const cats: string[] = [];
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) cats.push(category);
  }
  return cats.length > 0 ? cats : ['Garage Sale'];
}

// ============================================
// SOURCE ID — 3-field MD5 hash (strongest dedup)
// ============================================

export function generateSourceId(
  source: string,
  url: string,
  title: string
): string {
  const raw = `${source}|${url}|${title}`.toLowerCase().trim();
  return createHash('md5').update(raw).digest('hex');
}

// ============================================
// DATE PARSING
// ============================================

const MONTH_NAMES: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02',
  mar: '03', march: '03', apr: '04', april: '04',
  may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11',
  dec: '12', december: '12',
};

export function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;

  // ISO format: 2026-04-17
  const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // US slash format: 4/17/2026
  const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${month}-${day}`;
  }

  // FIX: Hyphen format: 4-17-2026 (common in CL titles like "Friday 4-17-2026")
  const hyphenMatch = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (hyphenMatch) {
    const month = hyphenMatch[1].padStart(2, '0');
    const day = hyphenMatch[2].padStart(2, '0');
    const year = hyphenMatch[3].length === 2 ? `20${hyphenMatch[3]}` : hyphenMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Month name format: April 17, 2026
  const monthMatch = dateStr.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i
  );
  if (monthMatch) {
    const month = MONTH_NAMES[monthMatch[1].toLowerCase()];
    const day = monthMatch[2].padStart(2, '0');
    const year = monthMatch[3] || new Date().getFullYear().toString();
    return `${year}-${month}-${day}`;
  }

  // Fallback: try native Date parser
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /* ignore */ }

  return null;
}

// ============================================
// TIME PARSING (supports a.m./p.m. with dots)
// ============================================

export function parseTime(timeStr: string | undefined): string | null {
  if (!timeStr) return null;

  const timeMatch = timeStr.match(
    /(\d{1,2}):?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?/i
  );
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const period = (timeMatch[3] || '').toLowerCase().replace(/\./g, '');

  if (period === 'pm' && hours < 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function parseTimeRange(
  text: string
): { start: string | null; end: string | null } {
  const rangeMatch = text.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?)[\s]*[-\u2013\u2014to]+[\s]*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.))/i
  );
  if (rangeMatch) {
    let startStr = rangeMatch[1];
    const endStr = rangeMatch[2];
    if (!/am|pm|a\.m\.|p\.m\./i.test(startStr)) {
      const suffix = endStr.match(/am|pm|a\.m\.|p\.m\./i);
      if (suffix) startStr += suffix[0];
    }
    return { start: parseTime(startStr), end: parseTime(endStr) };
  }
  return { start: null, end: null };
}

// ============================================
// EXTRACTION FUNCTIONS
// ============================================

export function extractAddress(text: string): string | null {
  const match = text.match(ADDRESS_PATTERN);
  return match ? match[0] : null;
}

export function extractZip(text: string): string | null {
  const match = text.match(ZIP_PATTERN);
  return match ? match[0] : null;
}

export function extractDates(text: string): string[] {
  const dates: string[] = [];
  for (const pattern of DATE_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, 'gi'));
    if (matches) dates.push(...matches);
  }
  return Array.from(new Set(dates));
}

export function extractTimes(text: string): string[] {
  const times: string[] = [];
  for (const pattern of TIME_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, 'gi'));
    if (matches) times.push(...matches);
  }
  return Array.from(new Set(times));
}

export function extractCity(address: string): string | null {
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2] || parts[parts.length - 1];
    return cityPart
      .replace(/\b[A-Z]{2}\b/, '')
      .replace(/\b\d{5}(-\d{4})?\b/, '')
      .trim() || null;
  }
  return null;
}

export function extractPrice(text: string | undefined): string | null {
  if (!text) return null;
  const priceMatch = text.match(/\$\s?(\d+(?:[.,]\d{2})?)/);
  return priceMatch ? priceMatch[1].replace(',', '') : null;
}

// ============================================
// ADDRESS VALIDATION — THE HARD GATE
// ============================================

export function isValidAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  const trimmed = address.trim();
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return false;
  return /^\d+\s+\S/.test(trimmed);
}

// ============================================
// PHOTO URL NORMALIZATION
// ============================================

export function normalizePhotoUrls(
  photos: string[] | undefined,
  baseUrl: string
): string[] {
  if (!photos || photos.length === 0) return [];
  return photos
    .filter((url) => url && url.length > 5)
    .map((url) => {
      if (url.startsWith('http')) return url;
      if (url.startsWith('//')) return `https:${url}`;
      try {
        return new URL(url, baseUrl).toString();
      } catch {
        return url;
      }
    })
    .filter((url) => url.startsWith('http'))
    .slice(0, 10);
}

// ============================================
// PAGE RELEVANCE SCORING (0-100)
// ============================================

export function scorePage(text: string): number {
  let score = 0;
  const lower = text.toLowerCase();

  let primaryCount = 0;
  for (const kw of PRIMARY_KEYWORDS) {
    if (lower.includes(kw)) primaryCount++;
  }
  score += Math.min(primaryCount * 20, 60);

  let secondaryCount = 0;
  for (const kw of SECONDARY_KEYWORDS) {
    if (lower.includes(kw)) secondaryCount++;
  }
  score += Math.min(secondaryCount * 5, 15);

  if (ADDRESS_PATTERN.test(text)) score += 10;
  if (DATE_PATTERNS.some((p) => p.test(text))) score += 10;
  if (TIME_PATTERNS.some((p) => p.test(text))) score += 5;

  return Math.min(score, 100);
}

export function hasPrimaryKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return PRIMARY_KEYWORDS.some((kw) => lower.includes(kw));
}

export function hasSecondaryKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return SECONDARY_KEYWORDS.some((kw) => lower.includes(kw));
}

// ============================================
// MAIN NORMALIZER
// ============================================

export function normalizeListing(raw: RawListing): NormalizedSale | null {
  // GATE 0: Must have a title
  if (!raw.title || raw.title.trim().length < 3) return null;

  const title = raw.title
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  // GATE 1: Junk title filter
  if (isJunkTitle(title)) return null;

  const description = raw.description
    ? raw.description.replace(/\s+/g, ' ').trim().slice(0, 2000)
    : null;

  const combinedText = `${title} ${description || ''}`;

  const source = raw.sourceName || 'Unknown';
  const sourceUrl = raw.sourceUrl || '';
  const sourceId = generateSourceId(source, sourceUrl, title);

  // GATE 2: ADDRESS — THE HARD GATE
  let address = raw.address || null;
  if (!isValidAddress(address)) {
    const fromDesc = extractAddress(combinedText);
    if (fromDesc) address = fromDesc;
  }
  if (!isValidAddress(address)) {
    const fromTitle = extractAddress(title);
    if (fromTitle) address = fromTitle;
  }
  if (!isValidAddress(address)) return null;

  const zip = raw.zip || extractZip(`${address} ${combinedText}`) || null;

  // ═══════════════════════════════════════════════════════════
  // FIX: DATE PRIORITY — title date > description date > raw.date
  //
  // raw.date from Craigslist is the POSTING datetime, NOT the
  // sale date. Sellers put the actual sale date in the title:
  //   "GARAGE SALE Friday 4-17-2026 Diecast & Hot Wheels"
  //
  // Old code: const rawDates = raw.date ? [raw.date] : extractDates(combinedText);
  // This always used the CL posting date and ignored the title date.
  //
  // New code: Check title first, then description, then raw.date as fallback.
  // ═══════════════════════════════════════════════════════════
  const titleDates = extractDates(title);
  const descDates = extractDates(description || '');
  const rawDates = titleDates.length > 0
    ? titleDates
    : descDates.length > 0
      ? descDates
      : raw.date
        ? [raw.date]
        : [];
  const saleDate = parseDate(rawDates[0]) || null;

  const timeRange = parseTimeRange(combinedText);
  const rawTimes = extractTimes(combinedText);
  const saleTimeStart = timeRange.start || parseTime(raw.time) || parseTime(rawTimes[0]) || null;
  const saleTimeEnd = timeRange.end || parseTime(rawTimes[1]) || null;

  const category = guessCategory(combinedText);
  const categories = guessCategories(combinedText);

  const price = extractPrice(raw.price?.toString()) || extractPrice(combinedText) || null;

  const photoUrls = normalizePhotoUrls(raw.photos, sourceUrl);

  const city = raw.city || extractCity(address || '') || null;

  const latitude =
    typeof raw.latitude === 'number' && !isNaN(raw.latitude) ? raw.latitude : null;
  const longitude =
    typeof raw.longitude === 'number' && !isNaN(raw.longitude) ? raw.longitude : null;

  const expiresAt = new Date(
    Date.now() + 14 * 24 * 60 * 60 * 1000
  ).toISOString();

  const collectedAt = new Date().toISOString();

  return {
    source,
    source_id: sourceId,
    source_url: sourceUrl,
    title,
    description,
    city,
    state: raw.state || null,
    latitude,
    longitude,
    price,
    sale_date: saleDate,
    sale_time_start: saleTimeStart,
    sale_time_end: saleTimeEnd,
    category,
    categories,
    photo_urls: photoUrls,
    address,
    zip,
    expires_at: expiresAt,
    collected_at: collectedAt,
  };
}

// ============================================
// BATCH NORMALIZER WITH DEDUP
// ============================================

export function normalizeAll(rawListings: RawListing[]): NormalizedSale[] {
  const normalized: NormalizedSale[] = [];
  const seenIds = new Set<string>();

  for (const raw of rawListings) {
    const sale = normalizeListing(raw);
    if (!sale) continue;

    if (seenIds.has(sale.source_id)) continue;
    seenIds.add(sale.source_id);

    normalized.push(sale);
  }

  return normalized;
}