// ============================================================
// FILE: src/lib/scrapers/yard-sale-normalizer.ts
// PLACE AT: src/lib/scrapers/yard-sale-normalizer.ts (REPLACE)
//
// YARD SALE NORMALIZER v4.1 — DESCRIPTION SANITIZER + CITY FIX
//
// CHANGES FROM v4.0:
// 1. NEW sanitizeDescription() — strips HTML tags, raw URLs,
//    image URLs, and excess whitespace from descriptions
// 2. ENHANCED extractCity() — handles more address formats
// 3. Applied sanitizeDescription() in normalizeListing()
//
// Everything else is IDENTICAL to v4.0.
// ============================================================

import { createHash } from 'crypto';

// ============================================
// TYPES
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
// KEYWORD DETECTION
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
  /\d{1,5}\s+(?:(?:N|S|E|W|NE|NW|SE|SW|North|South|East|West)\.?\s+)?(?:[A-Za-z0-9]+\s+){1,4}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Ter|Terrace|Hwy|Highway|Trail|Trl|Loop|Run|Pass|Path|Pike|Sq|Square|Alley|Aly|Grove|Grv|Ridge|Rdg|View|Vw|Crossing|Xing|Point|Pt|Commons|Cmns|Glen|Gln|Meadow|Mdw|Cove|Cv|Creek|Crk|Knoll|Knl|Spur|Row|Mall|Walk|Bend|Holw|Hollow)\b(?:\s*(?:#|Apt|Apt\.|Suite|Ste|Unit|Bldg|Fl|Floor|Rm|Room)\.?\s*\w+)?/i;

export const ZIP_PATTERN = /\b\d{5}(-\d{4})?\b/;

export const DATE_PATTERNS: RegExp[] = [
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s*\d{4}\b/i,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
  /\b\d{1,2}\/\d{1,2}(?!\/\d)\b/,          // v4.2: M/D without year — "3/14"
  /\b\d{1,2}-\d{1,2}-\d{2,4}\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(day)?\b/i,
];

export const TIME_PATTERNS: RegExp[] = [
  /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|AM|PM|a|p)\b/,
  /\b\d{1,2}(:\d{2})?\s*[-\u2013\u2014to]+\s*\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|AM|PM|a|p)\b/,
];

// ============================================
// HTML ENTITY CLEANUP (from v4.0)
// ============================================

function cleanHtmlEntities(text: string): string {
  return text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/ /g, ' ')
    .replace(/&#(\d+);/g, (_match, dec) =>
      String.fromCharCode(parseInt(dec, 10))
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================
// NEW in v4.1: DESCRIPTION SANITIZER
// Strips HTML tags, raw URLs, image links,
// and excess whitespace so descriptions display
// clean on YardShoppers listing pages.
// ============================================

function sanitizeDescription(raw: string): string {
  let text = raw;

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Strip raw image URLs (craigslist images, imgur, etc.)
  text = text.replace(/https?:\/\/images\.craigslist\.org[^\s)"]*/gi, '');
  text = text.replace(/https?:\/\/[^\s)"]*\.(?:jpg|jpeg|png|gif|webp|bmp|svg)[^\s)"]*/gi, '');

  // Strip all remaining raw URLs
  text = text.replace(/https?:\/\/[^\s)"]+/gi, '');
  text = text.replace(/www\.[^\s)"]+/gi, '');

  // Decode HTML entities that might remain
  text = text.replace(/&/g, '&');
  text = text.replace(/</g, '<');
  text = text.replace(/>/g, '>');
  text = text.replace(/"/g, '"');
  text = text.replace(/'/g, "'");
  text = text.replace(/ /g, ' ');

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  // Collapse multiple spaces into one
  text = text.replace(/ {2,}/g, ' ');

  // Remove lines that are ONLY whitespace
  text = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  text = text.trim();

  return text;
}

// ============================================
// TITLE METADATA STRIPPER v4.2
// Removes dates, times, and addresses from
// titles after extraction to dedicated fields.
// ============================================

function stripTitleMetadata(title: string): string {
  let t = title;

  // Full time ranges: "7am-12pm", "7:00 AM – 2:00 PM"
  t = t.replace(
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\.?\s*[-–—~]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\.?\b/gi,
    ''
  );
  // Partial range: "8-2pm", "7–12pm"
  t = t.replace(
    /\b\d{1,2}(?::\d{2})?\s*[-–—~]+\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\.?\b/gi,
    ''
  );
  // Standalone: "7am", "8:00 AM"
  t = t.replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)\.?\b/gi, '');
  // Bare number range where both sides are 1-12: "9-6"
  t = t.replace(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/g, (m, a, b) => {
    const na = parseInt(a), nb = parseInt(b);
    return na >= 1 && na <= 12 && nb >= 1 && nb <= 12 ? '' : m;
  });

  // Date: M/D or M/D/Y
  t = t.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, '');
  // Date: "March 14, 2026", "Mar 14"
  t = t.replace(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:\s*,?\s*\d{4})?\b/gi,
    ''
  );
  // Day names: "Saturday", "Fri"
  t = t.replace(
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?\b/gi,
    ''
  );

  // Street addresses: "308 Frisco Rd", "1309 East Avery St"
  t = t.replace(
    /\b\d{1,5}\s+(?:[A-Za-z]+\.?\s+){0,3}(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Hwy)\.?\b/gi,
    ''
  );

  // Cleanup
  t = t.replace(/^\s*(?:and|&)\s+/gi, '');
  t = t.replace(/\s+(?:and|&)\s*$/gi, '');
  t = t.replace(/\s{2,}/g, ' ').trim();
  t = t.replace(/^[\s\-–—,.:;]+/, '').replace(/[\s\-–—,.:;]+$/, '');

  return t.length >= 5 ? t : title;
}

// ============================================
// JUNK TITLE FILTER (65+ exact matches)
// ============================================

const JUNK_TITLES_EXACT = new Set([
  'find yard sales', 'find garage sales', 'find estate sales',
  'find garage sales by map', 'find garage sales by city and state',
  'find garage sales by zip code', 'find yard sales by map',
  'find yard sales by city and state', 'find yard sales by zip code',
  'post a yard sale', 'post a garage sale', 'post your yard sale',
  'post your garage sale', 'list your garage sale', 'list your yard sale',
  'list your garage sale for free', 'list your yard sale for free',
  'garage sale tips', 'yard sale tips', 'estate sale tips',
  'garage sale guide', 'yard sale guide',
  'how to have a garage sale', 'how to have a yard sale',
  'garage sale pricing guide', 'yard sale pricing guide',
  'about us', 'contact us', 'privacy policy', 'terms of service',
  'terms and conditions', 'sign up', 'sign in', 'log in', 'login',
  'register', 'create account', 'my account', 'my listings', 'my sales',
  'advertise with us', 'advertise', 'faq', 'help', 'blog', 'home', 'search',
  'alert me about new yard sales in this area!',
  'alert me about new yard sales in this area',
  'alert me about new garage sales in this area',
  'get alerts', 'set alerts', 'subscribe', 'newsletter',
  'download our app', 'get the app', 'mobile app',
  '', 'n/a', 'na', 'none', 'no title', 'untitled', 'test', 'testing',
  'asdf', 'null', 'undefined', 'click here', 'read more', 'learn more',
  'see details', 'view details', 'more info', 'info', 'details',
  'sale', 'event', 'listing', 'post', 'ad',
]);

const JUNK_PATTERNS: RegExp[] = [
  /^find\s+(yard|garage|estate)\s+sales?\b/i,
  /^post\s+(a|your)\s+(yard|garage|estate)\s+sale/i,
  /^list\s+your\s+(yard|garage|estate)\s+sale/i,
  /^(yard|garage|estate)\s+sale\s+(tips|guide|advice|help)/i,
  /^how\s+to\s+(have|run|organize|host)\s+a/i,
  /^(about|contact|privacy|terms|faq|help|blog|home|search)$/i,
  /^(sign|log)\s*(up|in|out)$/i,
  /^(create|my)\s+(account|listings?|sales?)$/i,
  /^alert\s+me\b/i,
  /^subscribe\b/i,
  /^get\s+(alerts?|the\s+app|started)/i,
  /^download\b/i,
  /^advertise\b/i,
  /^pricing\s+(guide|tips)/i,
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
  if (normalized.length < 8) return true;
  if (title === title.toUpperCase() && normalized.length < 30) {
    if (!/\d/.test(title)) return true;
  }
  return false;
}

// ============================================
// CATEGORY DETECTION (18 sale types + 6 content types)
// ============================================

const CATEGORY_PATTERNS: { pattern: RegExp; category: string }[] = [
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
// SOURCE ID — Craigslist URL normalization for dedup
// ============================================

function normalizeCraigslistUrl(url: string): string {
  const clDetailMatch = url.match(/craigslist\.org\/.*\/(\d{9,11})\.html/);
  if (clDetailMatch) {
    return `craigslist:${clDetailMatch[1]}`;
  }
  return url;
}

export function generateSourceId(
  source: string,
  url: string,
  title: string
): string {
  const normalizedSource = source.toLowerCase().trim();
  let normalizedUrl = url;
  if (normalizedSource === 'craigslist' || /craigslist/i.test(url)) {
    normalizedUrl = normalizeCraigslistUrl(url);
  }
  const raw = `${normalizedSource}|${normalizedUrl}|${title}`.toLowerCase().trim();
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

  const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  const usMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    const year = usMatch[3].length === 2 ? `20${usMatch[3]}` : usMatch[3];
    return `${year}-${month}-${day}`;
  }

  const hyphenMatch = dateStr.match(/(\d{1,2})-(\d{1,2})-(\d{2,4})/);
  if (hyphenMatch) {
    const month = hyphenMatch[1].padStart(2, '0');
    const day = hyphenMatch[2].padStart(2, '0');
    const year = hyphenMatch[3].length === 2 ? `20${hyphenMatch[3]}` : hyphenMatch[3];
    return `${year}-${month}-${day}`;
  }
    // v4.2: M/D without year → assume current year
  const mdNoYear = dateStr.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (mdNoYear) {
    const month = parseInt(mdNoYear[1]);
    const day = parseInt(mdNoYear[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const year = new Date().getFullYear();
      const d = new Date(year, month - 1, day);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
  }


  const monthMatch = dateStr.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i
  );
  if (monthMatch) {
    const month = MONTH_NAMES[monthMatch[1].toLowerCase()];
    const day = monthMatch[2].padStart(2, '0');
    const year = monthMatch[3] || new Date().getFullYear().toString();
    return `${year}-${month}-${day}`;
  }

  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  } catch { /* ignore */ }

  return null;
}

// ============================================
// TIME PARSING
// ============================================

export function parseTime(timeStr: string | undefined): string | null {
  if (!timeStr) return null;

  const timeMatch = timeStr.match(
    /(\d{1,2}):?(\d{2})?\s*(am|pm|a\.m\.|p\.m\.|a|p)\b/i
  );
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const period = (timeMatch[3] || '').toLowerCase().replace(/\./g, '');

  const normalizedPeriod = period === 'a' ? 'am' : period === 'p' ? 'pm' : period;

  if (normalizedPeriod === 'pm' && hours < 12) hours += 12;
  if (normalizedPeriod === 'am' && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function parseTimeRange(
  text: string
): { start: string | null; end: string | null } {
  const rangeMatch = text.match(
    /(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|a|p)?)\s*[-\u2013\u2014to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.|a|p))/i
  );
  if (rangeMatch) {
    let startStr = rangeMatch[1];
    const endStr = rangeMatch[2];

    if (!/am|pm|a\.m\.|p\.m\.|[ap]\b/i.test(startStr)) {
      const suffix = endStr.match(/am|pm|a\.m\.|p\.m\.|[ap]\b/i);
      if (suffix) startStr += suffix[0];
    }

    return { start: parseTime(startStr), end: parseTime(endStr) };
  }
  // v4.2: Bare number range: "9-6" → 9:00 AM – 6:00 PM
  const bareRange = text.match(/\b(\d{1,2})\s*[-–—]\s*(\d{1,2})\b/);
  if (bareRange) {
    const sn = parseInt(bareRange[1]), en = parseInt(bareRange[2]);
    if (sn >= 1 && sn <= 12 && en >= 1 && en <= 12) {
      const sp = sn >= 6 && sn <= 11 ? 'AM' : sn === 12 ? 'PM' : 'AM';
      const ep = en >= 1 && en <= 6 ? 'PM' : 'PM';
      return { start: parseTime(`${sn}:00 ${sp}`), end: parseTime(`${en}:00 ${ep}`) };
    }
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

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
]);

export function extractState(text: string): string | null {
  const stateMatch = text.match(/,\s*([A-Z]{2})\b/);
  if (stateMatch && US_STATES.has(stateMatch[1])) return stateMatch[1];

  const nearZipMatch = text.match(/\b([A-Z]{2})\s+\d{5}\b/);
  if (nearZipMatch && US_STATES.has(nearZipMatch[1])) return nearZipMatch[1];

  return null;
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

// ============================================
// ENHANCED extractCity() — v4.1
// Handles more address formats beyond comma-separated
// ============================================

export function extractCity(address: string): string | null {
  if (!address) return null;
  const trimmed = address.trim();

  // Method 1: Comma-separated — "123 Main St, Winston-Salem, NC 27101"
  const parts = trimmed.split(',').map((p) => p.trim());
  if (parts.length >= 2) {
    const cityPart = parts.length >= 3 ? parts[parts.length - 2] : parts[parts.length - 1];
    const cleaned = cityPart
      .replace(/\b[A-Z]{2}\b/, '')
      .replace(/\b\d{5}(-\d{4})?\b/, '')
      .trim();
    if (cleaned && cleaned.length >= 2) return cleaned;
  }

  // Method 2: City name before a 2-letter state code
  const beforeStateMatch = trimmed.match(
    /\b([A-Z][a-zA-Z\s-]{2,30})\s+(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/
  );
  if (beforeStateMatch) {
    const candidate = beforeStateMatch[1].trim();
    const streetSuffixes = /\b(St|Street|Ave|Avenue|Blvd|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pl|Place|Hwy|Highway)\s*$/i;
    if (!streetSuffixes.test(candidate) && candidate.length >= 2) {
      return candidate;
    }
  }

  // Method 3: Parenthesized location text — "(Walnut Cove)"
  const parenMatch = trimmed.match(/\(([A-Za-z\s-]{2,30})\)/);
  if (parenMatch) {
    return parenMatch[1].trim();
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

export function scoreAddress(address: string): number {
  let score = 0;
  if (!address) return 0;
  if (/^\d+\s/.test(address)) score += 30;
  if (/\b(St|Street|Ave|Avenue|Blvd|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)\b/i.test(address)) score += 20;
  if (/,\s*[A-Za-z]+/.test(address)) score += 15;
  if (/\b[A-Z]{2}\b/.test(address)) score += 15;
  if (/\b\d{5}\b/.test(address)) score += 20;
  return Math.min(score, 100);
}

// ============================================
// PHOTO URL NORMALIZATION (with dedup)
// ============================================

export function normalizePhotoUrls(
  photos: string[] | undefined,
  baseUrl: string
): string[] {
  if (!photos || photos.length === 0) return [];

  const seen = new Set<string>();
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
    .filter((url) => {
      const key = url.split('?')[0].toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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

  const rawTitle = cleanHtmlEntities(
    raw.title.replace(/\s+/g, ' ').trim().slice(0, 200)
  );

  // GATE 1: Junk title filter
  if (isJunkTitle(rawTitle)) return null;

  // v4.2: Strip dates, times, addresses from title after extraction uses the raw version
  const title = stripTitleMetadata(rawTitle);

  // v4.1: sanitizeDescription() strips HTML tags, raw URLs, image links
  let description: string | null = null;
  if (raw.description) {
    const cleaned = cleanHtmlEntities(
      raw.description.replace(/\s+/g, ' ').trim().slice(0, 2000)
    );
    description = sanitizeDescription(cleaned);
    if (!description || description.length < 3) description = null;
  }

  const combinedText = `${title} ${description || ''}`;
  const source = raw.sourceName || 'Unknown';
  const sourceUrl = raw.sourceUrl || '';
  const sourceId = generateSourceId(source, sourceUrl, title);

  // GATE 2: ADDRESS — THE HARD GATE
  let address = raw.address || null;
  if (address) address = cleanHtmlEntities(address);
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

  // DATE PRIORITY: title date > description date > raw.date
  const titleDates = extractDates(title);
  const descDates = extractDates(description || '');
  const rawDates =
    titleDates.length > 0 ? titleDates :
    descDates.length > 0 ? descDates :
    raw.date ? [raw.date] : [];
  const saleDate = parseDate(rawDates[0]) || null;

  const timeRange = parseTimeRange(combinedText);
  const rawTimes = extractTimes(combinedText);
  const saleTimeStart = timeRange.start || parseTime(raw.time) || parseTime(rawTimes[0]) || null;
  const saleTimeEnd = timeRange.end || parseTime(rawTimes[1]) || null;

  const category = guessCategory(combinedText);
  const categories = guessCategories(combinedText);
  const price = extractPrice(raw.price?.toString()) || extractPrice(combinedText) || null;
  const photoUrls = normalizePhotoUrls(raw.photos, sourceUrl);

  // v4.1: enhanced city extraction
  const city = raw.city || extractCity(address || '') || null;
  const state = raw.state || extractState(`${address} ${combinedText}`) || null;

  const latitude =
    typeof raw.latitude === 'number' && !isNaN(raw.latitude) ? raw.latitude : null;
  const longitude =
    typeof raw.longitude === 'number' && !isNaN(raw.longitude) ? raw.longitude : null;

  // SMART EXPIRY
  let expiresAt: string;
  if (saleDate) {
    const saleDateObj = new Date(saleDate + 'T23:59:59');
    saleDateObj.setDate(saleDateObj.getDate() + 1);
    expiresAt = saleDateObj.toISOString();
  } else {
    expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  }

  const collectedAt = new Date().toISOString();

  return {
    source,
    source_id: sourceId,
    source_url: sourceUrl,
    title,
    description,
    city,
    state,
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