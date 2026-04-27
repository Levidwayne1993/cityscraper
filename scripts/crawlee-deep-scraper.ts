// ============================================================
// FILE: scripts/crawlee-deep-scraper.ts (CityScraper project)
// REPLACES: scripts/crawlee-deep-scraper.ts
//
// CRAWLEE DEEP SCRAPER v4.5 — TITLE CLEANING + DATE FIX + CITY + CLEAN DESC
//
// v4.3 CHANGES:
//   1. FIX: buildStartUrls() restored to FULL v3.8 URL set with pagination:
//      - /gms pages 1-3 (3 URLs per subdomain)
//      - /sss?query=yard+sale+garage+sale pages 1-3 (3 URLs per subdomain)
//      - /sss?query=estate+sale (1 URL per subdomain)
//      - /sss?query=moving+sale (1 URL per subdomain)
//      = 8 URLs × 413 subdomains = 3,304 CL start URLs
//   2. FIX: Handler routing uses userData.handler !== 'detail' (not URL path)
//      so /sss index pages are processed correctly by Handler 1
//   3. FIX: maxConcurrency reduced from 10 → 2 (matching v3.8) to avoid bans
//   4. FIX: GarageSaleFinder URLs updated from /yard-sales/${state} (404s) to
//      /yard-sales/by-location/${stateAbbrev}/ (verified working, 84+ listings)
//   5. FIX: GSF_STATES changed from full names to 2-letter abbreviations
//   6. FIX: Removed duplicate const declarations (CL/ES/GSF/YSS/GSALR_MAX_PAGES)
//      that would crash TypeScript compilation
//
// v4.2 CHANGES:
//   1. NEW: cleanTitle() — strips source-site branding, excessive punctuation,
//      garbage chars, emoji, and collapses whitespace. Applied to ALL 6 index
//      handler title assignments (CL, ES JSON-LD, ES HTML, GSF, YSS, Gsalr).
//   2. FIX: CL index handler now sets date_start: null instead of CL posting
//      date — CL <time datetime> is when the AD was posted, not the sale date.
//   3. FIX: All 5 detail handlers now ALWAYS override date_start when
//      extractDateFromText() finds a date in the description (removed old
//      guards that prevented correct dates from overriding bad ones).
//   4. FIX: extractDateFromText() now checks ISO dates (YYYY-MM-DD) FIRST,
//      so CL descriptions with "date: 2026-04-18" are parsed correctly.
//   5. FIX: All 5 PATH B (direct DB update) blocks now also extract and
//      save date_start from description text.
//
// v4.1 CHANGES (PRESERVED):
//   1. NEW: CL_SUBDOMAIN_TO_CITY mapping — 413 entries converting CL subdomains
//      to real city names (e.g. 'winstonsalem' → 'Winston-Salem')
//   2. NEW: extractCityFromCLUrl() — extracts subdomain from request URL, looks
//      up in CL_SUBDOMAIN_TO_CITY mapping
//   3. NEW: extractCityFromAddress() — parses "City, ST" or "City, State" from
//      address text for non-CL sources
//   4. NEW: extractCityFromYSSSlug() — parses city name from YSS URL slug
//      (e.g. 'Birmingham-AL' → 'Birmingham', 'Winston-Salem-NC' → 'Winston-Salem')
//   5. FIX: cleanDescription() — now strips raw URLs (http/https/www), HTML tags
//      (<img>, <a>, etc.), and HTML entities (&amp; &lt; etc.)
//   6. FIX: ALL 10 HANDLERS now populate the `city` field:
//      - CL Index/Detail: from subdomain mapping + mapAddress fallback
//      - ES Index HTML fallback + ES Detail: from address text / itemprop
//      - GSF Index/Detail: from address text
//      - YSS Index/Detail: from URL slug (e.g. 'Birmingham-AL')
//      - Gsalr Index/Detail: from address text
//   7. FIX: buildStartUrls() now passes yssSlug in userData for YSS source
//
// v4.0 CHANGES (PRESERVED):
//   1. FIX: CL detail selector — cascading fallback instead of comma-join
//   2. NEW: cleanDescription() — strips CL/source junk
//   3. FIX: normalizeTime() — ensures "8 AM" becomes "8:00 AM"
//   4. cleanDescription() applied on ALL detail handlers
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
const GEOCODE_USER_AGENT = 'CityScraper/4.1 (cityscraper.org)';

// ── PAGINATION LIMITS ──
const CL_MAX_PAGES = 5;   // v4.4: bumped from 3 to catch big metros
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
  date_start: string | null;
  date_end: string | null;
  time_start: string | null;
  time_end: string | null;
  price_range: string | null;
  categories: string[];
  source: string;
  source_url: string;
  image_urls: string[];
  expires_at: string | null;
  scraped_at: string;
  pushed: boolean;
}

// ── PER-SOURCE COUNTERS ──
const sourceStats: Record<string, { success: number; failed: number; listings: number; pages: number; details: number }> = {
  craigslist: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
  estatesales: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
  garagesalefinder: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
  yardsalesearch: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
  gsalr: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
  ystm: { success: 0, failed: 0, listings: 0, pages: 0, details: 0 },
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
  // v4.4: additional sale types to maximize /sss coverage
  'attic[-\\s]*s[ae]i?le?s?',
  'basement[-\\s]*s[ae]i?le?s?',
  'sidewalk[-\\s]*s[ae]i?le?s?',
  'curb[-\\s]*s[ae]i?le?s?',
  'curbside[-\\s]*s[ae]i?le?s?',
  'warehouse[-\\s]*s[ae]i?le?s?',
  'charity[-\\s]*s[ae]i?le?s?',
  'benefit[-\\s]*s[ae]i?le?s?',
  'thrift[-\\s]*s[ae]i?le?s?',
  'blowout[-\\s]*s[ae]i?le?s?',
  'contents[-\\s]*s[ae]i?le?s?',
  'purge[-\\s]*s[ae]i?le?s?',
  'stoop[-\\s]*s[ae]i?le?s?',
  'lawn[-\\s]*s[ae]i?le?s?',
  'clear\\w*[-\\s]*out',
  'junk[-\\s]*s[ae]i?le?s?',
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
  // v4.2 FIX: ISO dates FIRST (YYYY-MM-DD) — CL descriptions use this format
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) {
    const d = new Date(isoMatch[1] + 'T12:00:00');
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  // "April 18, 2026" or "Apr 18 2026"
  const fullMatch = text.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
  if (fullMatch) {
    const d = new Date(fullMatch[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  // "4/18/2026" or "04/18/26"
  const slashMatch = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  if (slashMatch) {
    const d = new Date(slashMatch[1]);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  // v4.3 NEW: Relative day-of-week parsing ("Saturday", "this Sunday", "next Friday")
  // Resolves to the NEXT occurrence of that day from today
  const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayMatch = text.toLowerCase().match(/(?:this\s+|next\s+|happening\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (dayMatch) {
    const targetDay = dayNames.indexOf(dayMatch[1]);
    if (targetDay >= 0) {
      const now = new Date();
      const currentDay = now.getDay();
      let daysAhead = targetDay - currentDay;
      if (daysAhead <= 0) daysAhead += 7; // always resolve to future
      const target = new Date(now);
      target.setDate(target.getDate() + daysAhead);
      return target.toISOString().split('T')[0];
    }
  }
  // v4.3 NEW: "today" / "tomorrow" / "this weekend"
  const relMatch = text.toLowerCase().match(/\b(today|tomorrow|this weekend)\b/);
  if (relMatch) {
    const now = new Date();
    if (relMatch[1] === 'today') return now.toISOString().split('T')[0];
    if (relMatch[1] === 'tomorrow') {
      now.setDate(now.getDate() + 1);
      return now.toISOString().split('T')[0];
    }
    if (relMatch[1] === 'this weekend') {
      // Resolve to next Saturday
      const currentDay = now.getDay();
      let daysToSat = 6 - currentDay;
      if (daysToSat <= 0) daysToSat += 7;
      now.setDate(now.getDate() + daysToSat);
      return now.toISOString().split('T')[0];
    }
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

const MAX_PHOTOS = 1; // v4.6: 1 photo per listing to save bandwidth + storage
function getAllImgUrls(container: any, $: any): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  $(container).find('img').each((_: number, img: any) => {
    if (urls.length >= MAX_PHOTOS) return false; // stop early at cap
    const src =
      $(img).attr('src') ||
      $(img).attr('data-src') ||
      $(img).attr('data-lazy') ||
      $(img).attr('data-lazy-src') ||
      $(img).attr('data-original') ||
      $(img).attr('data-image') ||
      '';
    if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner') && !src.includes('spacer') && !src.includes('pixel') && src.length > 10) {
      const normalized = src.split('?')[0].replace(/\/+$/, '');
      if (!seen.has(normalized)) {
        seen.add(normalized);
        urls.push(src);
      }
    }
  });
  return urls;
}

function parseCraigslistDataIds($: any): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  $('[data-ids]').each((_: number, el: any) => {
    if (urls.length >= MAX_PHOTOS) return false; // stop early at cap
    const dataIds = $(el).attr('data-ids') || '';
    const ids = dataIds.split(',').map((id: string) => id.replace(/^\d+:/, '').trim());
    for (const id of ids) {
      if (urls.length >= MAX_PHOTOS) break; // stop at cap
      if (id && id.length > 3 && !seen.has(id)) {
        seen.add(id);
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
// v4.2 NEW: TITLE CLEANING
// Strips source-site branding, excessive punctuation, emoji,
// garbage chars, and normalizes whitespace.
// ══════════════════════════════════════════════════════════════
function cleanTitle(raw: string): string {
  if (!raw) return '';

  let t = raw;

  // ── Strip source-site branding prefixes ──
  // e.g. "Craigslist:", "Estate Sale -", "Garage Sale Finder:"
  t = t.replace(/^\s*(craigslist|estate\s*sales?\.net|garagesalefinder|yardsalesearch|gsalr)\s*[:\-–—|]+\s*/i, '');

  // ── Strip common noise prefixes ──
  // e.g. "HUGE!!!", "*** MOVING SALE ***"
  t = t.replace(/^[\s*!~#>•\-–—]+/, '');

  // ── Strip emoji and other symbol characters ──
  t = t.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}]/gu, '');

  // ── Strip excessive punctuation runs (3+ of same char) ──
  // "!!!" → "!", "***" → "", "---" → ""
  t = t.replace(/([!?]){3,}/g, '$1');
  t = t.replace(/[*~#]{2,}/g, '');
  t = t.replace(/[-–—]{3,}/g, '');

  // ── Strip garbage / control characters ──
  t = t.replace(/[\x00-\x1F\x7F]/g, '');

  // ── Decode common HTML entities ──
  t = t.replace(/&amp;/g, '&');
  t = t.replace(/&lt;/g, '<');
  t = t.replace(/&gt;/g, '>');
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&nbsp;/g, ' ');

  // ── Strip HTML tags (in case title contains markup) ──
  t = t.replace(/<[^>]*>/g, '');

  // ── Collapse whitespace ──
  t = t.replace(/[\r\n]+/g, ' ');
  t = t.replace(/\s{2,}/g, ' ');

  // ── Trim trailing punctuation junk ──
  t = t.replace(/[\s*!~#\-–—|:]+$/, '');

  return t.trim().slice(0, 300);
}

// ══════════════════════════════════════════════════════════════
// v4.0 + v4.1: DESCRIPTION CLEANING
// v4.0: Strips Craigslist page chrome and other source junk
// v4.1: NOW ALSO strips raw URLs, HTML tags, and HTML entities
// ══════════════════════════════════════════════════════════════
function cleanDescription(raw: string): string {
  if (!raw) return '';

  let text = raw;

  // ── v4.1 NEW: Strip HTML tags (e.g. <img>, <a href="...">, <br>, etc.) ──
  text = text.replace(/<[^>]*>/g, '');

  // ── v4.1 NEW: Strip raw image URLs (Craigslist images, etc.) ──
  text = text.replace(/https?:\/\/images\.craigslist\.org[^\s)"]*/gi, '');

  // ── v4.1 NEW: Strip ALL raw URLs ──
  text = text.replace(/https?:\/\/[^\s)"]+/gi, '');
  text = text.replace(/www\.[^\s)"]+/gi, '');

  // ── v4.1 NEW: Decode common HTML entities ──
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

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

// ══════════════════════════════════════════════════════════════
// v4.1 NEW: CITY EXTRACTION HELPERS
// ══════════════════════════════════════════════════════════════

// ── Extract city name from an address string ──
// Handles patterns like "123 Main St, Springfield, IL 62704"
// or "Springfield, IL" or "Springfield IL"
function extractCityFromAddress(addressText: string): string {
  if (!addressText) return '';

  // Pattern 1: "City, ST ZIP" or "City, ST"
  const match1 = addressText.match(/,\s*([A-Za-z][A-Za-z .'-]+?)\s*,\s*[A-Z]{2}\b/);
  if (match1) return match1[1].trim();

  // Pattern 2: "City, ST" at end of string
  const match2 = addressText.match(/([A-Za-z][A-Za-z .'-]+?)\s*,\s*[A-Z]{2}\s*(?:\d{5})?$/);
  if (match2) return match2[1].trim();

  // Pattern 3: just "City, State" (full state name)
  const match3 = addressText.match(/([A-Za-z][A-Za-z .'-]+?)\s*,\s*(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)/i);
  if (match3) return match3[1].trim();

  return '';
}

// ── Extract city from Craigslist URL using subdomain ──
function extractCityFromCLUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname; // e.g. "winstonsalem.craigslist.org"
    const subdomain = hostname.split('.')[0];
    return CL_SUBDOMAIN_TO_CITY[subdomain] || '';
  } catch {
    return '';
  }
}

// ── Extract city name from YardSaleSearch URL slug ──
// e.g. 'Birmingham-AL' → 'Birmingham'
// e.g. 'Winston-Salem-NC' → 'Winston-Salem'
// e.g. 'Salt-Lake-City-UT' → 'Salt Lake City'
function extractCityFromYSSSlug(slug: string): string {
  if (!slug) return '';
  // The last segment after '-' is always the 2-letter state code
  const parts = slug.split('-');
  if (parts.length < 2) return '';
  // Remove the last part (state code)
  const stateCode = parts.pop();
  if (!stateCode || stateCode.length !== 2) return slug; // safety
  // Rejoin remaining parts with spaces for multi-word cities
  // But keep hyphens that are part of the city name (e.g. Winston-Salem)
  // Known hyphenated cities:
  const hyphenatedCities: Record<string, string> = {
    'Winston-Salem': 'Winston-Salem',
    'Bowling-Green': 'Bowling Green',
    'Baton-Rouge': 'Baton Rouge',
    'Little-Rock': 'Little Rock',
    'Fort-Smith': 'Fort Smith',
    'Los-Angeles': 'Los Angeles',
    'San-Francisco': 'San Francisco',
    'San-Diego': 'San Diego',
    'San-Jose': 'San Jose',
    'San-Antonio': 'San Antonio',
    'Fort-Worth': 'Fort Worth',
    'Fort-Wayne': 'Fort Wayne',
    'Fort-Collins': 'Fort Collins',
    'Fort-Lauderdale': 'Fort Lauderdale',
    'Fort-Myers': 'Fort Myers',
    'Las-Vegas': 'Las Vegas',
    'Las-Cruces': 'Las Cruces',
    'New-York': 'New York',
    'New-Haven': 'New Haven',
    'New-Orleans': 'New Orleans',
    'Long-Beach': 'Long Beach',
    'Santa-Rosa': 'Santa Rosa',
    'Santa-Barbara': 'Santa Barbara',
    'Santa-Fe': 'Santa Fe',
    'St-Petersburg': 'St. Petersburg',
    'St-Paul': 'St. Paul',
    'St-Louis': 'St. Louis',
    'St-George': 'St. George',
    'Salt-Lake-City': 'Salt Lake City',
    'Kansas-City': 'Kansas City',
    'Oklahoma-City': 'Oklahoma City',
    'Colorado-Springs': 'Colorado Springs',
    'Cedar-Rapids': 'Cedar Rapids',
    'Des-Moines': 'Des Moines',
    'Iowa-City': 'Iowa City',
    'Sioux-City': 'Sioux City',
    'Sioux-Falls': 'Sioux Falls',
    'Grand-Rapids': 'Grand Rapids',
    'Ann-Arbor': 'Ann Arbor',
    'Traverse-City': 'Traverse City',
    'Overland-Park': 'Overland Park',
    'Lake-Charles': 'Lake Charles',
    'Silver-Spring': 'Silver Spring',
    'Idaho-Falls': 'Idaho Falls',
    'South-Bend': 'South Bend',
    'Corpus-Christi': 'Corpus Christi',
    'El-Paso': 'El Paso',
    'Broken-Arrow': 'Broken Arrow',
    'Cape-Coral': 'Cape Coral',
    'Daytona-Beach': 'Daytona Beach',
    'Jersey-City': 'Jersey City',
    'Toms-River': 'Toms River',
    'Cherry-Hill': 'Cherry Hill',
    'Rio-Rancho': 'Rio Rancho',
    'Grand-Forks': 'Grand Forks',
    'Grand-Island': 'Grand Island',
    'Virginia-Beach': 'Virginia Beach',
    'Myrtle-Beach': 'Myrtle Beach',
    'Rock-Hill': 'Rock Hill',
    'Rapid-City': 'Rapid City',
    'Green-Bay': 'Green Bay',
    'Eau-Claire': 'Eau Claire',
    'Great-Falls': 'Great Falls',
  };
  const cityPart = parts.join('-');
  if (hyphenatedCities[cityPart]) return hyphenatedCities[cityPart];
  // Default: replace hyphens with spaces
  return parts.join(' ');
}


// ════════════════════════════════════════════════════════════
// END OF PART 1/6
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// PART 2/6 — POST-CRAWL FUNCTIONS, CITY/STATE ARRAYS,
//            CL_SUBDOMAIN_TO_CITY MAPPING (v4.1 NEW)
// ════════════════════════════════════════════════════════════

// ── POST-CRAWL: Delete listings without a valid street address ──
async function postCrawlAddressCleanup(): Promise<void> {
  log.info('Post-crawl: cleaning up listings without valid street addresses...');

  const { data: rows, error } = await supabase
    .from('yard_sales')
    .select('id, address')
    .order('scraped_at', { ascending: false })
    .limit(5000);

  if (error || !rows) {
    log.error(`Address cleanup query failed: ${error?.message}`);
    return;
  }

  const badIds: string[] = [];
  for (const row of rows) {
    if (!row.address || !hasValidAddress(row.address)) {
      badIds.push(row.id);
    }
  }

  if (badIds.length === 0) {
    log.info('Address cleanup: all listings have valid addresses.');
    return;
  }

  // Delete in chunks of 100
  for (let i = 0; i < badIds.length; i += 100) {
    const chunk = badIds.slice(i, i + 100);
    const { error: delErr } = await supabase
      .from('yard_sales')
      .delete()
      .in('id', chunk);
    if (delErr) {
      log.error(`Address cleanup delete error: ${delErr.message}`);
    }
  }
  log.info(`Address cleanup: removed ${badIds.length} listings without valid street addresses.`);
}

// ── POST-CRAWL: Geocode addresses with missing lat/lng ──
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`;
    const res = await fetch(url, {
      headers: { 'User-Agent': GEOCODE_USER_AGENT },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
    }
    return null;
  } catch {
    return null;
  }
}

async function postCrawlGeocode(): Promise<void> {
  log.info('Post-crawl: geocoding addresses with missing lat/lng...');

  const { data: rows, error } = await supabase
    .from('yard_sales')
    .select('id, address, city, state, zip')
    .is('lat', null)
    .not('address', 'is', null)
    .order('scraped_at', { ascending: false })
    .limit(2000);

  if (error || !rows || rows.length === 0) {
    log.info('Geocode: no rows need geocoding (or query failed).');
    return;
  }

  log.info(`Geocode: ${rows.length} rows to geocode.`);
  let geocoded = 0;
  let failed = 0;

  for (const row of rows) {
    const fullAddr = [row.address, row.city, row.state, row.zip].filter(Boolean).join(', ');
    const result = await geocodeAddress(fullAddr);

    if (result) {
      const { error: upErr } = await supabase
        .from('yard_sales')
        .update({ lat: result.lat, lng: result.lng })
        .eq('id', row.id);
      if (!upErr) geocoded++;
      else failed++;
    } else {
      failed++;
    }

    // Respect Nominatim rate limits
    await new Promise((r) => setTimeout(r, GEOCODE_DELAY_MS));
  }

  log.info(`Geocode complete: ${geocoded} geocoded, ${failed} failed.`);
}

// ══════════════════════════════════════════════════════════════
// CITY/STATE ARRAYS — ALL 5 SOURCES
// ══════════════════════════════════════════════════════════════

// ── CRAIGSLIST: State → Subdomain slugs (413 total) ──
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
  IL: ['bn','carbondale','chambana','chicago','decatur','lasalle','mattoon','peoria','rockford','springfieldil','quincy'],
  IN: ['bloomington','evansville','fortwayne','indianapolis','kokomo','lafayette','muncie','richmondin','southbend','terrehaute'],
  IA: ['ames','cedarrapids','desmoines','dubuque','fortdodge','iowacity','masoncity','quadcities','siouxcity','waterloo'],
  KS: ['lawrence','ksu','nwks','salina','seks','swks','topeka','wichita'],
  KY: ['bgky','eastky','lexington','louisville','owensboro','westky'],
  LA: ['batonrouge','cenla','houma','lafayette','lakecharles','monroe','neworleans','shreveport'],
  ME: ['maine'],
  MD: ['annapolis','baltimore','easternshore','frederick','smd','westmd'],
  MA: ['boston','capecod','southcoast','westernmass','worcester'],
  MI: ['annarbor','battlecreek','centralmich','detroit','flint','grandrapids','holland','jxn','kalamazoo','lansing','monroemi','muskegon','nmi','porthuron','saginaw','swmi','thumb','up'],
  MN: ['bemidji','brainerd','duluth','mankato','minneapolis','rmn','stcloud'],
  MS: ['gulfport','hattiesburg','jackson','meridian','northmiss','natchez'],
  MO: ['columbiamo','joplin','kansascity','kirksville','loz','semo','springfield','stjoseph','stlouis'],
  MT: ['billings','bozeman','butte','greatfalls','helena','kalispell','missoula'],
  NE: ['grandisland','lincoln','northplatte','omaha','scottsbluff'],
  NV: ['elko','lasvegas','reno'],
  NH: ['nh'],
  NJ: ['cnj','jerseyshore','newjersey','southjersey'],
  NM: ['albuquerque','clovis','farmington','lascruces','roswell','santafe'],
  NY: ['albany','binghamton','buffalo','catskills','chautauqua','elmira','fingerlakes','glensfalls','hudsonvalley','ithaca','longisland','newyork','oneonta','plattsburgh','potsdam','rochester','syracuse','utica','watertown'],
  NC: ['asheville','boone','charlotte','eastnc','fayetteville','greensboro','hickory','jacksonvillenc','outerbanks','raleigh','wilmington','winstonsalem'],
  ND: ['bismarck','fargo','grandforks','nd'],
  OH: ['akroncanton','athensohio','chillicothe','cincinnati','cleveland','columbus','dayton','limaohio','mansfield','sandusky','toledo','tuscarawas','youngstown','zanesville'],
  OK: ['lawton','oklahomacity','stillwater','tulsa'],
  OR: ['bend','corvallis','eastoregon','eugene','klamath','medford','oregoncoast','portland','roseburg','salem'],
  PA: ['altoona','chambersburg','erie','harrisburg','lancaster','lehighvalley','meadville','philadelphia','pittsburgh','poconos','reading','scranton','pennstate','williamsport','york'],
  RI: ['providence'],
  SC: ['charleston','columbia','florencesc','greenville','hiltonhead','myrtlebeach'],
  SD: ['rapidcity','siouxfalls','sd'],
  TN: ['chattanooga','clarksville','cookeville','jacksontn','knoxville','memphis','nashville','tricities'],
  TX: ['abilene','amarillo','austin','beaumont','brownsville','collegestation','corpuschristi','dallas','easttexas','elpaso','galveston','houston','killeen','laredo','lubbock','mcallen','midland','nacogdoches','odessa','sanangelo','sanantonio','sanmarcos','texoma','victoriatx','waco','wichitafalls'],
  UT: ['logan','ogden','provo','saltlakecity','stgeorge'],
  VT: ['burlington'],
  VA: ['charlottesville','danville','fredericksburg','harrisonburg','lynchburg','blacksburg','norfolk','richmond','roanoke','swva','winchester'],
  WA: ['bellingham','kennewick','kpr','moseslake','olympic','pullman','seattle','skagit','spokane','wenatchee','yakima'],
  WV: ['charlestonwv','huntington','martinsburg','morgantown','parkersburg','wv','wheeling'],
  WI: ['appleton','eauclaire','greenbay','janesville','kenosha','lacrosse','madison','milwaukee','racine','sheboygan','wausau'],
  WY: ['wyoming'],
};

// ══════════════════════════════════════════════════════════════
// v4.1 NEW: CL SUBDOMAIN → REAL CITY NAME MAPPING
// Maps every CL subdomain slug to a proper human-readable city
// name so the `city` field is always populated for CL listings.
// ══════════════════════════════════════════════════════════════
const CL_SUBDOMAIN_TO_CITY: Record<string, string> = {
  // ── AL ──
  auburn: 'Auburn',
  birmingham: 'Birmingham',
  dothan: 'Dothan',
  florence: 'Florence',
  gadsden: 'Gadsden',
  huntsville: 'Huntsville',
  mobile: 'Mobile',
  montgomery: 'Montgomery',
  tuscaloosa: 'Tuscaloosa',
  // ── AK ──
  anchorage: 'Anchorage',
  fairbanks: 'Fairbanks',
  kenai: 'Kenai',
  juneau: 'Juneau',
  // ── AZ ──
  flagstaff: 'Flagstaff',
  mohave: 'Mohave',
  phoenix: 'Phoenix',
  prescott: 'Prescott',
  showlow: 'Show Low',
  sierravista: 'Sierra Vista',
  tucson: 'Tucson',
  yuma: 'Yuma',
  // ── AR ──
  fayar: 'Fayetteville',
  fortsmith: 'Fort Smith',
  jonesboro: 'Jonesboro',
  littlerock: 'Little Rock',
  texarkana: 'Texarkana',
  // ── CA ──
  bakersfield: 'Bakersfield',
  chico: 'Chico',
  fresno: 'Fresno',
  goldcountry: 'Gold Country',
  hanford: 'Hanford',
  humboldt: 'Eureka',
  imperial: 'El Centro',
  inlandempire: 'Riverside',
  losangeles: 'Los Angeles',
  mendocino: 'Ukiah',
  merced: 'Merced',
  modesto: 'Modesto',
  monterey: 'Monterey',
  orangecounty: 'Anaheim',
  palmsprings: 'Palm Springs',
  redding: 'Redding',
  sacramento: 'Sacramento',
  sandiego: 'San Diego',
  sfbay: 'San Francisco',
  slo: 'San Luis Obispo',
  santabarbara: 'Santa Barbara',
  santamaria: 'Santa Maria',
  siskiyou: 'Yreka',
  stockton: 'Stockton',
  susanville: 'Susanville',
  ventura: 'Ventura',
  visalia: 'Visalia',
  yubasutter: 'Yuba City',
  // ── CO ──
  boulder: 'Boulder',
  cosprings: 'Colorado Springs',
  denver: 'Denver',
  eastco: 'Burlington',
  fortcollins: 'Fort Collins',
  rockies: 'Glenwood Springs',
  pueblo: 'Pueblo',
  westslope: 'Grand Junction',
  // ── CT ──
  newlondon: 'New London',
  hartford: 'Hartford',
  newhaven: 'New Haven',
  nwct: 'Danbury',
  // ── DE ──
  delaware: 'Wilmington',
  // ── DC ──
  washingtondc: 'Washington',
  // ── FL ──
  broward: 'Fort Lauderdale',
  daytona: 'Daytona Beach',
  keys: 'Key West',
  fortlauderdale: 'Fort Lauderdale',
  fortmyers: 'Fort Myers',
  gainesville: 'Gainesville',
  cfl: 'Orlando',
  jacksonville: 'Jacksonville',
  lakeland: 'Lakeland',
  miami: 'Miami',
  northcentralfl: 'Ocala',
  ocala: 'Ocala',
  okaloosa: 'Fort Walton Beach',
  orlando: 'Orlando',
  panamacity: 'Panama City',
  pensacola: 'Pensacola',
  sarasota: 'Sarasota',
  southflorida: 'West Palm Beach',
  spacecoast: 'Melbourne',
  staugustine: 'St. Augustine',
  tallahassee: 'Tallahassee',
  tampa: 'Tampa',
  treasure: 'Port St. Lucie',
  palmbeach: 'West Palm Beach',
  // ── GA ──
  albanyga: 'Albany',
  athensga: 'Athens',
  atlanta: 'Atlanta',
  augusta: 'Augusta',
  brunswick: 'Brunswick',
  columbusga: 'Columbus',
  macon: 'Macon',
  nwga: 'Dalton',
  savannah: 'Savannah',
  statesboro: 'Statesboro',
  valdosta: 'Valdosta',
  // ── HI ──
  honolulu: 'Honolulu',
  // ── ID ──
  boise: 'Boise',
  eastidaho: 'Idaho Falls',
  lewiston: 'Lewiston',
  twinfalls: 'Twin Falls',
  // ── IL ──
  bn: 'Bloomington',
  carbondale: 'Carbondale',
  chambana: 'Champaign',
  chicago: 'Chicago',
  decatur: 'Decatur',
  lasalle: 'La Salle',
  mattoon: 'Mattoon',
  peoria: 'Peoria',
  rockford: 'Rockford',
  springfieldil: 'Springfield',
  quincy: 'Quincy',
  // ── IN ──
  bloomington: 'Bloomington',
  evansville: 'Evansville',
  fortwayne: 'Fort Wayne',
  indianapolis: 'Indianapolis',
  kokomo: 'Kokomo',
  lafayette: 'Lafayette',
  muncie: 'Muncie',
  richmondin: 'Richmond',
  southbend: 'South Bend',
  terrehaute: 'Terre Haute',
  // ── IA ──
  ames: 'Ames',
  cedarrapids: 'Cedar Rapids',
  desmoines: 'Des Moines',
  dubuque: 'Dubuque',
  fortdodge: 'Fort Dodge',
  iowacity: 'Iowa City',
  masoncity: 'Mason City',
  quadcities: 'Davenport',
  siouxcity: 'Sioux City',
  waterloo: 'Waterloo',
  // ── KS ──
  lawrence: 'Lawrence',
  ksu: 'Manhattan',
  nwks: 'Hays',
  salina: 'Salina',
  seks: 'Pittsburg',
  swks: 'Dodge City',
  topeka: 'Topeka',
  wichita: 'Wichita',
  // ── KY ──
  bgky: 'Bowling Green',
  eastky: 'Ashland',
  lexington: 'Lexington',
  louisville: 'Louisville',
  owensboro: 'Owensboro',
  westky: 'Paducah',
  // ── LA ──
  batonrouge: 'Baton Rouge',
  cenla: 'Alexandria',
  houma: 'Houma',
  // lafayette already defined in IN — CL shares the slug; city context comes from state
  lakecharles: 'Lake Charles',
  monroe: 'Monroe',
  neworleans: 'New Orleans',
  shreveport: 'Shreveport',
  // ── ME ──
  maine: 'Portland',
  // ── MD ──
  annapolis: 'Annapolis',
  baltimore: 'Baltimore',
  easternshore: 'Salisbury',
  frederick: 'Frederick',
  smd: 'Waldorf',
  westmd: 'Cumberland',
  // ── MA ──
  boston: 'Boston',
  capecod: 'Cape Cod',
  southcoast: 'New Bedford',
  westernmass: 'Springfield',
  worcester: 'Worcester',
  // ── MI ──
  annarbor: 'Ann Arbor',
  battlecreek: 'Battle Creek',
  centralmich: 'Mount Pleasant',
  detroit: 'Detroit',
  flint: 'Flint',
  grandrapids: 'Grand Rapids',
  holland: 'Holland',
  jxn: 'Jackson',
  kalamazoo: 'Kalamazoo',
  lansing: 'Lansing',
  monroemi: 'Monroe',
  muskegon: 'Muskegon',
  nmi: 'Traverse City',
  porthuron: 'Port Huron',
  saginaw: 'Saginaw',
  swmi: 'Kalamazoo',
  thumb: 'Bad Axe',
  up: 'Marquette',
  // ── MN ──
  bemidji: 'Bemidji',
  brainerd: 'Brainerd',
  duluth: 'Duluth',
  mankato: 'Mankato',
  minneapolis: 'Minneapolis',
  rmn: 'Rochester',
  stcloud: 'St. Cloud',
  // ── MS ──
  gulfport: 'Gulfport',
  hattiesburg: 'Hattiesburg',
  jackson: 'Jackson',
  meridian: 'Meridian',
  northmiss: 'Oxford',
  natchez: 'Natchez',
  // ── MO ──
  columbiamo: 'Columbia',
  joplin: 'Joplin',
  kansascity: 'Kansas City',
  kirksville: 'Kirksville',
  loz: 'Lake of the Ozarks',
  semo: 'Cape Girardeau',
  springfield: 'Springfield',
  stjoseph: 'St. Joseph',
  stlouis: 'St. Louis',
  // ── MT ──
  billings: 'Billings',
  bozeman: 'Bozeman',
  butte: 'Butte',
  greatfalls: 'Great Falls',
  helena: 'Helena',
  kalispell: 'Kalispell',
  missoula: 'Missoula',
  // ── NE ──
  grandisland: 'Grand Island',
  lincoln: 'Lincoln',
  northplatte: 'North Platte',
  omaha: 'Omaha',
  scottsbluff: 'Scottsbluff',
  // ── NV ──
  elko: 'Elko',
  lasvegas: 'Las Vegas',
  reno: 'Reno',
  // ── NH ──
  nh: 'Manchester',
  // ── NJ ──
  cnj: 'New Brunswick',
  jerseyshore: 'Asbury Park',
  newjersey: 'Newark',
  southjersey: 'Cherry Hill',
  // ── NM ──
  albuquerque: 'Albuquerque',
  clovis: 'Clovis',
  farmington: 'Farmington',
  lascruces: 'Las Cruces',
  roswell: 'Roswell',
  santafe: 'Santa Fe',
  // ── NY ──
  albany: 'Albany',
  binghamton: 'Binghamton',
  buffalo: 'Buffalo',
  catskills: 'Catskills',
  chautauqua: 'Chautauqua',
  elmira: 'Elmira',
  fingerlakes: 'Geneva',
  glensfalls: 'Glens Falls',
  hudsonvalley: 'Poughkeepsie',
  ithaca: 'Ithaca',
  longisland: 'Long Island',
  newyork: 'New York',
  oneonta: 'Oneonta',
  plattsburgh: 'Plattsburgh',
  potsdam: 'Potsdam',
  rochester: 'Rochester',
  syracuse: 'Syracuse',
  utica: 'Utica',
  watertown: 'Watertown',
  // ── NC ──
  asheville: 'Asheville',
  boone: 'Boone',
  charlotte: 'Charlotte',
  eastnc: 'Greenville',
  fayetteville: 'Fayetteville',
  greensboro: 'Greensboro',
  hickory: 'Hickory',
  jacksonvillenc: 'Jacksonville',
  outerbanks: 'Outer Banks',
  raleigh: 'Raleigh',
  wilmington: 'Wilmington',
  winstonsalem: 'Winston-Salem',
  // ── ND ──
  bismarck: 'Bismarck',
  fargo: 'Fargo',
  grandforks: 'Grand Forks',
  nd: 'Minot',
  // ── OH ──
  akroncanton: 'Akron',
  athensohio: 'Athens',
  chillicothe: 'Chillicothe',
  cincinnati: 'Cincinnati',
  cleveland: 'Cleveland',
  columbus: 'Columbus',
  dayton: 'Dayton',
  limaohio: 'Lima',
  mansfield: 'Mansfield',
  sandusky: 'Sandusky',
  toledo: 'Toledo',
  tuscarawas: 'Dover',
  youngstown: 'Youngstown',
  zanesville: 'Zanesville',
  // ── OK ──
  lawton: 'Lawton',
  oklahomacity: 'Oklahoma City',
  stillwater: 'Stillwater',
  tulsa: 'Tulsa',
  // ── OR ──
  bend: 'Bend',
  corvallis: 'Corvallis',
  eastoregon: 'Pendleton',
  eugene: 'Eugene',
  klamath: 'Klamath Falls',
  medford: 'Medford',
  oregoncoast: 'Newport',
  portland: 'Portland',
  roseburg: 'Roseburg',
  salem: 'Salem',
  // ── PA ──
  altoona: 'Altoona',
  chambersburg: 'Chambersburg',
  erie: 'Erie',
  harrisburg: 'Harrisburg',
  lancaster: 'Lancaster',
  lehighvalley: 'Allentown',
  meadville: 'Meadville',
  philadelphia: 'Philadelphia',
  pittsburgh: 'Pittsburgh',
  poconos: 'Stroudsburg',
  reading: 'Reading',
  scranton: 'Scranton',
  pennstate: 'State College',
  williamsport: 'Williamsport',
  york: 'York',
  // ── RI ──
  providence: 'Providence',
  // ── SC ──
  charleston: 'Charleston',
  columbia: 'Columbia',
  florencesc: 'Florence',
  greenville: 'Greenville',
  hiltonhead: 'Hilton Head',
  myrtlebeach: 'Myrtle Beach',
  // ── SD ──
  rapidcity: 'Rapid City',
  siouxfalls: 'Sioux Falls',
  sd: 'Pierre',
  // ── TN ──
  chattanooga: 'Chattanooga',
  clarksville: 'Clarksville',
  cookeville: 'Cookeville',
  jacksontn: 'Jackson',
  knoxville: 'Knoxville',
  memphis: 'Memphis',
  nashville: 'Nashville',
  tricities: 'Johnson City',
  // ── TX ──
  abilene: 'Abilene',
  amarillo: 'Amarillo',
  austin: 'Austin',
  beaumont: 'Beaumont',
  brownsville: 'Brownsville',
  collegestation: 'College Station',
  corpuschristi: 'Corpus Christi',
  dallas: 'Dallas',
  easttexas: 'Tyler',
  elpaso: 'El Paso',
  galveston: 'Galveston',
  houston: 'Houston',
  killeen: 'Killeen',
  laredo: 'Laredo',
  lubbock: 'Lubbock',
  mcallen: 'McAllen',
  midland: 'Midland',
  nacogdoches: 'Nacogdoches',
  odessa: 'Odessa',
  sanangelo: 'San Angelo',
  sanantonio: 'San Antonio',
  sanmarcos: 'San Marcos',
  texoma: 'Sherman',
  victoriatx: 'Victoria',
  waco: 'Waco',
  wichitafalls: 'Wichita Falls',
  // ── UT ──
  logan: 'Logan',
  ogden: 'Ogden',
  provo: 'Provo',
  saltlakecity: 'Salt Lake City',
  stgeorge: 'St. George',
  // ── VT ──
  burlington: 'Burlington',
  // ── VA ──
  charlottesville: 'Charlottesville',
  danville: 'Danville',
  fredericksburg: 'Fredericksburg',
  harrisonburg: 'Harrisonburg',
  lynchburg: 'Lynchburg',
  blacksburg: 'Blacksburg',
  norfolk: 'Norfolk',
  richmond: 'Richmond',
  roanoke: 'Roanoke',
  swva: 'Bristol',
  winchester: 'Winchester',
  // ── WA ──
  bellingham: 'Bellingham',
  kennewick: 'Kennewick',
  kpr: 'Kennewick',
  moseslake: 'Moses Lake',
  olympic: 'Olympia',
  pullman: 'Pullman',
  seattle: 'Seattle',
  skagit: 'Mount Vernon',
  spokane: 'Spokane',
  wenatchee: 'Wenatchee',
  yakima: 'Yakima',
  // ── WV ──
  charlestonwv: 'Charleston',
  huntington: 'Huntington',
  martinsburg: 'Martinsburg',
  morgantown: 'Morgantown',
  parkersburg: 'Parkersburg',
  wv: 'Charleston',
  wheeling: 'Wheeling',
  // ── WI ──
  appleton: 'Appleton',
  eauclaire: 'Eau Claire',
  greenbay: 'Green Bay',
  janesville: 'Janesville',
  kenosha: 'Kenosha',
  lacrosse: 'La Crosse',
  madison: 'Madison',
  milwaukee: 'Milwaukee',
  racine: 'Racine',
  sheboygan: 'Sheboygan',
  wausau: 'Wausau',
  // ── WY ──
  wyoming: 'Cheyenne',
};

// ── ESTATESALES.NET: State names (hyphenated) ──
const ESTATE_SALES_STATES: string[] = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New-Hampshire','New-Jersey','New-Mexico','New-York','North-Carolina',
  'North-Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode-Island',
  'South-Carolina','South-Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West-Virginia','Wisconsin','Wyoming',
];

// ── GARAGESALEFINDER: State names (hyphenated) ──
const GSF_STATES: string[] = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
];

// ── YARDSALESEARCH: 274 city slugs (City-ST format) ──
const YSS_CITIES: string[] = [
  'Birmingham-AL','Huntsville-AL','Mobile-AL','Montgomery-AL','Tuscaloosa-AL',
  'Anchorage-AK','Fairbanks-AK',
  'Chandler-AZ','Gilbert-AZ','Glendale-AZ','Mesa-AZ','Peoria-AZ','Phoenix-AZ','Scottsdale-AZ','Surprise-AZ','Tempe-AZ','Tucson-AZ',
  'Fayetteville-AR','Fort-Smith-AR','Little-Rock-AR','Jonesboro-AR',
  'Anaheim-CA','Bakersfield-CA','Chula-Vista-CA','Fontana-CA','Fremont-CA','Fresno-CA','Irvine-CA','Long-Beach-CA','Los-Angeles-CA','Modesto-CA','Moreno-Valley-CA','Oakland-CA','Oceanside-CA','Ontario-CA','Oxnard-CA','Riverside-CA','Sacramento-CA','San-Bernardino-CA','San-Diego-CA','San-Francisco-CA','San-Jose-CA','Santa-Ana-CA','Santa-Clarita-CA','Santa-Rosa-CA','Stockton-CA',
  'Aurora-CO','Colorado-Springs-CO','Denver-CO','Fort-Collins-CO','Lakewood-CO','Pueblo-CO','Thornton-CO','Westminster-CO',
  'Bridgeport-CT','Hartford-CT','New-Haven-CT','Stamford-CT','Waterbury-CT',
  'Wilmington-DE',
  'Washington-DC',
  'Cape-Coral-FL','Clearwater-FL','Coral-Springs-FL','Fort-Lauderdale-FL','Gainesville-FL','Hialeah-FL','Hollywood-FL','Jacksonville-FL','Lakeland-FL','Miami-FL','Miramar-FL','Orlando-FL','Palm-Bay-FL','Pembroke-Pines-FL','Pompano-Beach-FL','Port-St-Lucie-FL','St-Petersburg-FL','Tallahassee-FL','Tampa-FL','West-Palm-Beach-FL',
  'Athens-GA','Atlanta-GA','Augusta-GA','Columbus-GA','Macon-GA','Savannah-GA',
  'Honolulu-HI',
  'Boise-ID','Idaho-Falls-ID','Meridian-ID','Nampa-ID',
  'Aurora-IL','Chicago-IL','Elgin-IL','Joliet-IL','Naperville-IL','Peoria-IL','Rockford-IL','Springfield-IL',
  'Evansville-IN','Fort-Wayne-IN','Indianapolis-IN','South-Bend-IN',
  'Cedar-Rapids-IA','Davenport-IA','Des-Moines-IA','Iowa-City-IA','Sioux-City-IA','Waterloo-IA',
  'Kansas-City-KS','Olathe-KS','Overland-Park-KS','Topeka-KS','Wichita-KS',
  'Bowling-Green-KY','Lexington-KY','Louisville-KY','Owensboro-KY',
  'Baton-Rouge-LA','Lafayette-LA','Lake-Charles-LA','New-Orleans-LA','Shreveport-LA',
  'Portland-ME',
  'Baltimore-MD','Frederick-MD','Silver-Spring-MD',
  'Boston-MA','Cambridge-MA','Lowell-MA','Springfield-MA','Worcester-MA',
  'Ann-Arbor-MI','Detroit-MI','Flint-MI','Grand-Rapids-MI','Lansing-MI','Sterling-Heights-MI','Warren-MI',
  'Duluth-MN','Minneapolis-MN','Rochester-MN','St-Paul-MN',
  'Gulfport-MS','Jackson-MS',
  'Columbia-MO','Independence-MO','Kansas-City-MO','Springfield-MO','St-Louis-MO',
  'Billings-MT','Great-Falls-MT','Missoula-MT',
  'Lincoln-NE','Omaha-NE',
  'Henderson-NV','Las-Vegas-NV','North-Las-Vegas-NV','Reno-NV',
  'Manchester-NH','Nashua-NH',
  'Elizabeth-NJ','Jersey-City-NJ','Newark-NJ','Paterson-NJ','Toms-River-NJ','Trenton-NJ',
  'Albuquerque-NM','Las-Cruces-NM','Rio-Rancho-NM','Santa-Fe-NM',
  'Albany-NY','Buffalo-NY','New-York-NY','Rochester-NY','Syracuse-NY','Yonkers-NY',
  'Charlotte-NC','Durham-NC','Fayetteville-NC','Greensboro-NC','Raleigh-NC','Wilmington-NC','Winston-Salem-NC',
  'Bismarck-ND','Fargo-ND','Grand-Forks-ND',
  'Akron-OH','Canton-OH','Cincinnati-OH','Cleveland-OH','Columbus-OH','Dayton-OH','Toledo-OH','Youngstown-OH',
  'Broken-Arrow-OK','Norman-OK','Oklahoma-City-OK','Tulsa-OK',
  'Bend-OR','Eugene-OR','Gresham-OR','Medford-OR','Portland-OR','Salem-OR',
  'Allentown-PA','Erie-PA','Harrisburg-PA','Lancaster-PA','Philadelphia-PA','Pittsburgh-PA','Reading-PA','Scranton-PA',
  'Providence-RI','Warwick-RI',
  'Charleston-SC','Columbia-SC','Greenville-SC','Myrtle-Beach-SC','North-Charleston-SC','Rock-Hill-SC',
  'Rapid-City-SD','Sioux-Falls-SD',
  'Chattanooga-TN','Clarksville-TN','Knoxville-TN','Memphis-TN','Murfreesboro-TN','Nashville-TN',
  'Abilene-TX','Amarillo-TX','Arlington-TX','Austin-TX','Beaumont-TX','Brownsville-TX','Carrollton-TX','College-Station-TX','Corpus-Christi-TX','Dallas-TX','Denton-TX','El-Paso-TX','Fort-Worth-TX','Frisco-TX','Garland-TX','Grand-Prairie-TX','Houston-TX','Irving-TX','Killeen-TX','Laredo-TX','Lubbock-TX','McAllen-TX','McKinney-TX','Mesquite-TX','Midland-TX','Odessa-TX','Pasadena-TX','Plano-TX','San-Angelo-TX','San-Antonio-TX','Waco-TX','Wichita-Falls-TX',
  'Logan-UT','Ogden-UT','Provo-UT','Salt-Lake-City-UT','St-George-UT','West-Jordan-UT','West-Valley-City-UT',
  'Burlington-VT',
  'Alexandria-VA','Arlington-VA','Chesapeake-VA','Hampton-VA','Lynchburg-VA','Newport-News-VA','Norfolk-VA','Richmond-VA','Roanoke-VA','Virginia-Beach-VA',
  'Bellevue-WA','Everett-WA','Kent-WA','Olympia-WA','Seattle-WA','Spokane-WA','Tacoma-WA','Vancouver-WA','Yakima-WA',
  'Charleston-WV','Huntington-WV','Morgantown-WV',
  'Appleton-WI','Eau-Claire-WI','Green-Bay-WI','Kenosha-WI','Madison-WI','Milwaukee-WI','Racine-WI',
  'Casper-WY','Cheyenne-WY',
];

// ── GSALR: lowercase state names (hyphenated) ──
const GSALR_STATES: string[] = [
  'alabama','alaska','arizona','arkansas','california','colorado','connecticut',
  'delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa',
  'kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan',
  'minnesota','mississippi','missouri','montana','nebraska','nevada',
  'new-hampshire','new-jersey','new-mexico','new-york','north-carolina',
  'north-dakota','ohio','oklahoma','oregon','pennsylvania','rhode-island',
  'south-carolina','south-dakota','tennessee','texas','utah','vermont',
  'virginia','washington','west-virginia','wisconsin','wyoming',
];

const GSALR_MAX_PAGES = 3;

// ── YardSaleTreasureMap.com — 50 states (separate company, unique data pool) ──
const YSTM_STATES: string[] = [
  'Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
  'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa',
  'Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan',
  'Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada',
  'New-Hampshire','New-Jersey','New-Mexico','New-York','North-Carolina',
  'North-Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode-Island',
  'South-Carolina','South-Dakota','Tennessee','Texas','Utah','Vermont',
  'Virginia','Washington','West-Virginia','Wisconsin','Wyoming',
];

// ════════════════════════════════════════════════════════════
// END OF PART 2/6
// ════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════
// PART 3/6 — buildStartUrls, saveBatchToSupabase, main() START,
//            HANDLER 1 (CL Index), HANDLER 2 (CL Detail)
// ════════════════════════════════════════════════════════════

// ── Build start URLs for ALL 5 sources ──
// ── v3.8 PAGINATION CONSTANTS (restored) ──

function buildStartUrls(): { url: string; userData: Record<string, string> }[] {
  const urls: { url: string; userData: Record<string, string> }[] = [];

  // ── Craigslist: /gms (3 pages) + /sss yard+garage (3 pages) + /sss estate + /sss moving ──
  // = 8 URLs per subdomain × 413 subdomains = 3,304 CL URLs
  for (const [state, subdomains] of Object.entries(CRAIGSLIST_CITIES)) {
    for (const sub of subdomains) {
      // GMS category — page 1
      urls.push({
        url: `https://${sub}.craigslist.org/search/gms`,
        userData: { source: 'craigslist', state },
      });
      // GMS pagination — pages 2-3
      for (let page = 1; page < CL_MAX_PAGES; page++) {
        urls.push({
          url: `https://${sub}.craigslist.org/search/gms?s=${page * 120}`,
          userData: { source: 'craigslist', state },
        });
      }
      // SSS combined yard+garage query — page 1
      urls.push({
        url: `https://${sub}.craigslist.org/search/sss?query=yard+sale+garage+sale`,
        userData: { source: 'craigslist', state },
      });
      // SSS combined yard+garage pagination — pages 2-3
      for (let page = 1; page < CL_MAX_PAGES; page++) {
        urls.push({
          url: `https://${sub}.craigslist.org/search/sss?query=yard+sale+garage+sale&s=${page * 120}`,
          userData: { source: 'craigslist', state },
        });
      }
      // SSS estate+sale sub-query (no pagination — low volume)
      urls.push({
        url: `https://${sub}.craigslist.org/search/sss?query=estate+sale`,
        userData: { source: 'craigslist', state },
      });
      // SSS moving+sale sub-query (no pagination — low volume)
      urls.push({
        url: `https://${sub}.craigslist.org/search/sss?query=moving+sale`,
        userData: { source: 'craigslist', state },
      });
      // v4.5: CCC community events — yard/garage sales posted as events
      urls.push({
        url: `https://${sub}.craigslist.org/search/ccc?query=yard+sale`,
        userData: { source: 'craigslist', state },
      });
      urls.push({
        url: `https://${sub}.craigslist.org/search/ccc?query=garage+sale`,
        userData: { source: 'craigslist', state },
      });
    }
  }

  // ── EstateSales.net — 5 pages per state ──
  for (const state of ESTATE_SALES_STATES) {
    urls.push({
      url: `https://www.estatesales.net/estate-sales/${state}`,
      userData: { source: 'estatesales', state },
    });
    for (let page = 2; page <= ES_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.estatesales.net/estate-sales/${state}?page=${page}`,
        userData: { source: 'estatesales', state },
      });
    }
  }

  // ── GarageSaleFinder — 5 pages per state ──
  for (const state of GSF_STATES) {
    urls.push({
      url: `https://www.garagesalefinder.com/yard-sales/by-location/${state}/`,
      userData: { source: 'garagesalefinder', state },
    });
    for (let page = 2; page <= GSF_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.garagesalefinder.com/yard-sales/by-location/${state}/?page=${page}`,
        userData: { source: 'garagesalefinder', state },
      });
    }
  }

  // ── YardSaleSearch — 5 pages per city ── (v4.1: added yssSlug to userData)
  for (const city of YSS_CITIES) {
    const state = city.split('-').pop() || '';
    urls.push({
      url: `https://www.yardsalesearch.com/yard-sales/${city}.html`,
      userData: { source: 'yardsalesearch', state, yssSlug: city },
    });
    for (let page = 2; page <= YSS_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.yardsalesearch.com/yard-sales/${city}.html?page=${page}`,
        userData: { source: 'yardsalesearch', state, yssSlug: city },
      });
    }
  }

  // ── Gsalr — 3 pages per state ──
  for (const state of GSALR_STATES) {
    urls.push({
      url: `https://gsalr.com/${state}/`,
      userData: { source: 'gsalr', state },
    });
    for (let page = 2; page <= GSALR_MAX_PAGES; page++) {
      urls.push({
        url: `https://gsalr.com/${state}/page/${page}/`,
        userData: { source: 'gsalr', state },
      });
    }
  }

  // ── v4.5: YardSaleTreasureMap — state directory pages (discover city URLs dynamically) ──
  for (const ystmState of YSTM_STATES) {
    urls.push({
      url: `https://yardsaletreasuremap.com/US/${ystmState}/`,
      userData: { source: 'ystm', state: ystmState },
    });
  }

  log.info(`Built ${urls.length} start URLs.`);
  return urls;
}

// ── Save batch of scraped sales to Supabase ──
async function saveBatchToSupabase(sales: ScrapedSale[]): Promise<void> {
  if (sales.length === 0) return;

  const chunkSize = 50;
  for (let i = 0; i < sales.length; i += chunkSize) {
    const chunk = sales.slice(i, i + chunkSize);
    const { error } = await supabase
      .from('yard_sales')
      .upsert(chunk, { onConflict: 'source_url' });
    if (error) {
      log.error(`Supabase upsert error (batch ${i / chunkSize + 1}): ${error.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// MAIN CRAWLER FUNCTION
// ══════════════════════════════════════════════════════════════
async function main(): Promise<void> {
  await purgeDefaultStorages();

  const startUrls = buildStartUrls();
  const pendingSales: ScrapedSale[] = [];
  let totalProcessed = 0;

  // ScraperAPI proxy config
  const proxyConfiguration = new ProxyConfiguration({
    proxyUrls: [
      `http://scraperapi:${SCRAPER_API_KEY}@proxy-server.scraperapi.com:8001`,
    ],
  });

  const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 2,
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    async requestHandler({ request, $, enqueueLinks }) {
      const { source, state } = request.userData as { source: string; state: string };

      // ══════════════════════════════════════════════════════
      // HANDLER 1: CRAIGSLIST INDEX (search results page)
      // ══════════════════════════════════════════════════════
      if (source === 'craigslist' && request.userData.handler !== 'detail') {
        // This is a CL search listing page
        const results = $('li.result-row, .cl-static-search-result');
        if (results.length === 0) {
          log.info(`[CL Index] 0 listings on ${request.url}`);
          return;
        }

        log.info(`[CL Index] ${results.length} raw listings on ${request.url}`);
        sourceStats.craigslist.pages++;

        const detailUrls: { url: string; userData: Record<string, any> }[] = [];
        results.each((_, el) => {
          const $el = $(el);
          const titleEl = $el.find('.result-title, .posting-title a, a.titlestring');
          // v4.2 FIX: CL static HTML (via ScraperAPI) puts title in <li title="...">
          // attribute and link in a plain <a> with no class — fall back to those
          let title = titleEl.text().trim() || $el.attr('title') || '';
          const link = titleEl.attr('href') || $el.find('a').attr('href') || '';
          const locationText = $el.find('.result-hood').text().trim().replace(/[()]/g, '');
          const dateStr = $el.find('time').attr('datetime') || '';

          if (!title || !link) return;
          // v4.4: Only filter /sss results — /gms is the dedicated yard sale category
          const isSSS = request.url.includes('/sss') || request.url.includes('/ccc');
          if (isSSS && !isYardSale(title)) return;

          const fullUrl = link.startsWith('http') ? link : `https://${request.url.split('/')[2]}${link}`;

          // v4.1: Extract city from CL subdomain URL
          const clCity = extractCityFromCLUrl(request.url);
          // Also try extracting from locationText (e.g. "Winston-Salem")
          const locationCity = extractCityFromAddress(locationText);

          const sale: ScrapedSale = {
            source_id: fullUrl.split('/').pop()?.replace('.html', '') || '',
            title: cleanTitle(title),  // v4.2 FIX: clean title
            description: '',
            address: locationText || '',
            city: locationCity || clCity || '',
            state: state || '',
            zip: extractZip(locationText) || '',
            lat: null,
            lng: null,
            date_start: dateStr ? dateStr.split('T')[0] : null, // v4.3: use CL posting date as fallback — detail handler overrides with real sale date if found
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'craigslist',
            source_url: fullUrl,
            image_urls: [],
            expires_at: null,
            scraped_at: new Date().toISOString(),
            pushed: false,
          };

          pendingSales.push(sale);
          sourceStats.craigslist.listings++;

          // Collect detail URL for manual enqueueing (enqueueLinks CSS selectors
          // fail on CL static HTML — this is the reliable path)
          detailUrls.push({
            url: fullUrl,
            userData: { source: 'craigslist', state, handler: 'detail' },
          });
        });

        // Enqueue detail pages directly (bypasses broken CSS selector matching)
        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls, { forefront: true });
          log.info(`[CL Index] Enqueued ${detailUrls.length} detail pages from ${request.url}`);
        }

        // Pagination: enqueue next page (up to CL_MAX_PAGES)
        const currentPage = request.userData.page ? parseInt(request.userData.page, 10) : 1;
        if (currentPage < CL_MAX_PAGES) {
          const nextBtn = $('a.button.next');
          const nextUrl = nextBtn.attr('href');
          if (nextUrl) {
            const fullNextUrl = nextUrl.startsWith('http')
              ? nextUrl
              : `https://${request.url.split('/')[2]}${nextUrl}`;
            await crawler.addRequests([{
              url: fullNextUrl,
              userData: { source: 'craigslist', state, page: String(currentPage + 1) },
            }]);
          }
        }

        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 2: CRAIGSLIST DETAIL (individual listing)
      // ══════════════════════════════════════════════════════
      if (source === 'craigslist' && request.userData.handler === 'detail') {
        const postingBody = $('#postingbody').length
          ? $('#postingbody').html() || ''
          : $('.posting-body').html() || '';

        const description = cleanDescription(postingBody);
        const mapAddress = $('div.mapaddress').text().trim();
        const lat = $('div.viewposting').attr('data-latitude') || null;
        const lng = $('div.viewposting').attr('data-longitude') || null;
        const images = getAllImgUrls($("body"), $);

        // v4.1: Extract city from map address or CL URL
        const detailCity = extractCityFromAddress(mapAddress) || extractCityFromCLUrl(request.url) || '';
        const detailZip = extractZip(mapAddress) || '';
        const detailAddress = extractAddressFromText(mapAddress) || mapAddress || '';

        // Try to find and enrich the matching pending sale
        const existingSale = pendingSales.find((s) => s.source_url === request.url);

        if (existingSale) {
          // ── PATH A: Enrich in-memory sale ──
          existingSale.description = description || existingSale.description;
          existingSale.address = detailAddress || existingSale.address;
          // v4.1: Set city if still empty
          if (!existingSale.city) {
            existingSale.city = detailCity;
          }
          existingSale.zip = detailZip || existingSale.zip;
          existingSale.lat = lat ? parseFloat(lat) : existingSale.lat;
          existingSale.lng = lng ? parseFloat(lng) : existingSale.lng;
          existingSale.image_urls = images.length > 0 ? images : existingSale.image_urls;

          // Extract times from description
          const times = extractTimes(description);
          existingSale.time_start = times.time_start || existingSale.time_start;
          existingSale.time_end = times.time_end || existingSale.time_end;

          // v4.2 FIX: ALWAYS try to extract date from description (override CL posting date)
          const descDate = extractDateFromText(description);
          if (descDate) existingSale.date_start = descDate;
        } else {
          // ── PATH B: Direct DB update (sale was already saved in a prior batch) ──
          const updateData: Record<string, unknown> = {};
          if (description) updateData.description = description;
          if (detailAddress) updateData.address = detailAddress;
          // v4.1: Always set city on direct updates too
          if (detailCity) updateData.city = detailCity;
          if (detailZip) updateData.zip = detailZip;
          if (lat) updateData.lat = parseFloat(lat);
          if (lng) updateData.lng = parseFloat(lng);
          if (images.length > 0) updateData.image_urls = images;

          const times = extractTimes(description);
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;

          // v4.2 FIX: Always try to extract real sale date from description
          const descDate = extractDateFromText(description);
          if (descDate) updateData.date_start = descDate;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (upErr) {
              log.debug(`CL Detail DB update failed: ${upErr.message}`);
            }
          }
        }

        sourceStats.craigslist.details++;
        return;
      }

// ════════════════════════════════════════════════════════════
// END OF PART 3/6
// ════════════════════════════════════════════════════════════


      // ══════════════════════════════════════════════════════
      // HANDLER 3: ESTATESALES.NET INDEX (state listing page)
      // ══════════════════════════════════════════════════════
      if (source === 'estatesales' && !request.url.includes('/sale/')) {
        log.info(`[ES Index] Processing ${request.url}`);
        sourceStats.estatesales.pages++;

        // Strategy 1: JSON-LD structured data
        const jsonLdScripts = $('script[type="application/ld+json"]');
        let foundJsonLd = false;

        jsonLdScripts.each((_, el) => {
          try {
            const json = JSON.parse($(el).html() || '{}');
            const items = json['@graph'] || (Array.isArray(json) ? json : [json]);

            for (const item of items) {
              if (item['@type'] !== 'Event' && item['@type'] !== 'Sale') continue;
              foundJsonLd = true;

              const title = item.name || '';
              if (!title) continue;

              const addr = item.location?.address || {};
              const streetAddress = addr.streetAddress || '';
              const city = addr.addressLocality || '';
              const stateCode = addr.addressRegion || state || '';
              const zip = addr.postalCode || '';
              const lat = item.location?.geo?.latitude || null;
              const lng = item.location?.geo?.longitude || null;
              const startDate = item.startDate || '';
              const endDate = item.endDate || '';
              const sourceUrl = item.url || '';
              const image = item.image || '';

              const sale: ScrapedSale = {
                source_id: sourceUrl.split('/').pop() || '',
                title: cleanTitle(title),  // v4.2 FIX: clean title
                description: item.description || '',
                address: streetAddress,
                city,
                state: stateCode,
                zip,
                lat: lat ? parseFloat(lat) : null,
                lng: lng ? parseFloat(lng) : null,
                date_start: startDate ? startDate.split('T')[0] : null,
                date_end: endDate ? endDate.split('T')[0] : null,
                time_start: null,
                time_end: null,
                price_range: null,
                categories: guessCategories(title + ' ' + (item.description || '')),
                source: 'estatesales',
                source_url: sourceUrl.startsWith('http')
                  ? sourceUrl
                  : `https://www.estatesales.net${sourceUrl}`,
                image_urls: image ? [image] : [],
                expires_at: endDate || null,
                scraped_at: new Date().toISOString(),
                pushed: false,
              };

              pendingSales.push(sale);
              sourceStats.estatesales.listings++;
            }
          } catch {
            // JSON parse failed, fall through to HTML strategy
          }
        });

        // Strategy 2: HTML fallback
        if (!foundJsonLd) {
          const cards = $('.sale-card, .estate-sale-card, .listing-card, article');
          cards.each((_, el) => {
            const $card = $(el);
            const title = $card.find('h2, h3, .sale-title, .title').first().text().trim();
            const link = $card.find('a').first().attr('href') || '';
            const addressText = $card.find('.address, .location, .sale-address').text().trim();
            const dateText = $card.find('.date, .sale-date, time').text().trim();

            if (!title || !link) return;

            const fullUrl = link.startsWith('http')
              ? link
              : `https://www.estatesales.net${link}`;

            // v4.1: Extract city from address text instead of leaving blank
            const esCity = extractCityFromAddress(addressText) || '';

            const sale: ScrapedSale = {
              source_id: link.split('/').pop() || '',
              title: cleanTitle(title),  // v4.2 FIX: clean title
              description: '',
              address: extractAddressFromText(addressText) || addressText,
              city: esCity,
              state: state || '',
              zip: extractZip(addressText) || '',
              lat: null,
              lng: null,
              date_start: extractDateFromText(dateText),
              date_end: null,
              time_start: null,
              time_end: null,
              price_range: null,
              categories: guessCategories(title),
              source: 'estatesales',
              source_url: fullUrl,
              image_urls: [],
              expires_at: null,
              scraped_at: new Date().toISOString(),
              pushed: false,
            };

            pendingSales.push(sale);
            sourceStats.estatesales.listings++;
          });
        }

        // Enqueue detail pages
        await enqueueLinks({
          selector: 'a[href*="/sale/"]',
          userData: { source: 'estatesales', state, handler: 'detail' },
        });

        // Pagination
        const currentPage = request.userData.page ? parseInt(request.userData.page, 10) : 1;
        if (currentPage < ES_MAX_PAGES) {
          const nextUrl = $('a.next, a[rel="next"], .pagination a:contains("Next")').attr('href');
          if (nextUrl) {
            const fullNextUrl = nextUrl.startsWith('http')
              ? nextUrl
              : `https://www.estatesales.net${nextUrl}`;
            await crawler.addRequests([{
              url: fullNextUrl,
              userData: { source: 'estatesales', state, page: String(currentPage + 1) },
            }]);
          }
        }

        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 4: ESTATESALES.NET DETAIL (individual sale)
      // ══════════════════════════════════════════════════════
      if (source === 'estatesales' && request.url.includes('/sale/')) {
        const title = $('h1').first().text().trim();
        const description = cleanDescription(
          $('.sale-description, .description, #sale-description').html() || ''
        );
        const addressEl = $('[itemprop="streetAddress"], .street-address').text().trim();
        const cityEl = $('[itemprop="addressLocality"]').text().trim();
        const stateEl = $('[itemprop="addressRegion"]').text().trim();
        const zipEl = $('[itemprop="postalCode"]').text().trim();
        const lat = $('[itemprop="latitude"]').attr('content') || null;
        const lng = $('[itemprop="longitude"]').attr('content') || null;
        const images = getAllImgUrls($("body"), $);

        const dateText = $('.sale-dates, .dates, [itemprop="startDate"]').text().trim();
        const times = extractTimes(dateText + ' ' + description);

        // Try to find and enrich the matching pending sale
        const existingSale = pendingSales.find((s) => s.source_url === request.url);

        if (existingSale) {
          // ── PATH A: Enrich in-memory ──
          existingSale.description = description || existingSale.description;
          if (addressEl) existingSale.address = addressEl;
          if (cityEl) existingSale.city = cityEl;
          if (stateEl) existingSale.state = stateEl;
          if (zipEl) existingSale.zip = zipEl;
          if (lat) existingSale.lat = parseFloat(lat);
          if (lng) existingSale.lng = parseFloat(lng);
          if (images.length > 0) existingSale.image_urls = images;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          // v4.2 FIX: ALWAYS try to extract date from description (override bad dates)
          const esDescDate = extractDateFromText(dateText || description);
          if (esDescDate) existingSale.date_start = esDescDate;
        } else {
          // ── PATH B: Direct DB update ──
          const updateData: Record<string, unknown> = {};
          if (description) updateData.description = description;
          if (addressEl) updateData.address = addressEl;
          if (cityEl) updateData.city = cityEl;
          if (stateEl) updateData.state = stateEl;
          if (zipEl) updateData.zip = zipEl;
          if (lat) updateData.lat = parseFloat(lat);
          if (lng) updateData.lng = parseFloat(lng);
          if (images.length > 0) updateData.image_urls = images;
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;

          // v4.2 FIX: Always try to extract real sale date from description
          const esDescDate2 = extractDateFromText(dateText || description);
          if (esDescDate2) updateData.date_start = esDescDate2;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (upErr) {
              log.debug(`ES Detail DB update failed: ${upErr.message}`);
            }
          }
        }

        sourceStats.estatesales.details++;
        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 5: GARAGESALEFINDER INDEX (state listing)
      // ══════════════════════════════════════════════════════
      // v4.4: Rewritten to match GSF's actual HTML — table rows, not article cards
      // GSF state pages have: city directory links at top + "Recently Added Sales" table
      // Table columns: Photos | Sales (address link) | City | Date(s)
      if (source === 'garagesalefinder' && !request.url.includes('/yard-sale/')) {
        log.info(`[GSF Index] Processing ${request.url}`);
        sourceStats.garagesalefinder.pages++;

        // GSF uses a table with rows: each <tr> has <td> cells
        // Skip header row (has <th> elements)
        const rows = $('table tr').filter((_, el) => $(el).find('td').length > 0);
        log.info(`[GSF Index] Found ${rows.length} listing rows on ${request.url}`);

        rows.each((_, el) => {
          const $row = $(el);
          const cells = $row.find('td');

          // Columns: 0=Photos, 1=Address/Sale link, 2=City, 3=Dates
          const addressCell = cells.eq(1);
          const cityCell = cells.eq(2);
          const dateCell = cells.eq(3);
          const photoCell = cells.eq(0);

          const addressLink = addressCell.find('a').first();
          const addressText = addressLink.text().trim();
          const link = addressLink.attr('href') || '';
          const cityText = cityCell.text().trim();
          const dateText = dateCell.text().trim();

          // Photo: check for img in photo cell, or photo link title
          const photoImg = photoCell.find('img').attr('src') || '';
          const photoLink = photoCell.find('a[title*="photos for sale"]').attr('href') || '';

          if (!addressText || !link) return;

          const fullUrl = link.startsWith('http')
            ? link
            : `https://www.garagesalefinder.com${link}`;

          // Parse address components — GSF addresses are "Street, City, ST ZIP"
          const gsfCity = cityText || extractCityFromAddress(addressText) || '';
          const gsfState = state || '';
          const gsfZip = extractZip(addressText) || '';

          // Build a title from the address since GSF doesn't have separate titles
          const saleTitle = cleanTitle(`Yard Sale in ${gsfCity || gsfState}`);

          // Parse dates — GSF uses "04/25/26" or "04/25/26 - 04/26/26"
          const dateParts = dateText.split(' - ');
          const dateStart = extractDateFromText(dateParts[0]) || null;
          const dateEnd = dateParts.length > 1 ? extractDateFromText(dateParts[1]) : null;

          // Extract sale ID from photo link title or URL
          const saleIdMatch = (photoCell.find('a').attr('title') || '').match(/sale (\d+)/);
          const saleId = saleIdMatch ? saleIdMatch[1] : link.split('/').pop() || '';

          const sale: ScrapedSale = {
            source_id: saleId,
            title: saleTitle,
            description: '',
            address: addressText || '',
            city: gsfCity,
            state: gsfState,
            zip: gsfZip,
            lat: null,
            lng: null,
            date_start: dateStart,
            date_end: dateEnd,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: guessCategories(addressText),
            source: 'garagesalefinder',
            source_url: fullUrl,
            image_urls: photoImg ? [photoImg] : [],
            expires_at: null,
            scraped_at: new Date().toISOString(),
            pushed: false,
          };

          pendingSales.push(sale);
          sourceStats.garagesalefinder.listings++;
        });

        // Enqueue detail pages for enrichment (description, more photos)
        const detailLinks: { url: string; userData: Record<string, any> }[] = [];
        $('a[href*="/yard-sale/"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href) return;
          const fullHref = href.startsWith('http')
            ? href
            : `https://www.garagesalefinder.com${href}`;
          detailLinks.push({
            url: fullHref,
            userData: { source: 'garagesalefinder', state, handler: 'detail' },
          });
        });
        if (detailLinks.length > 0) {
          await crawler.addRequests(detailLinks, { forefront: true });
          log.info(`[GSF Index] Enqueued ${detailLinks.length} detail pages from ${request.url}`);
        }

        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 6: GARAGESALEFINDER DETAIL (individual sale)
      // ══════════════════════════════════════════════════════
      if (source === 'garagesalefinder' && request.url.includes('/yard-sale/')) {
        const title = $('h1').first().text().trim();
        const description = cleanDescription(
          $('.sale-description, .description, .sale-details').html() || $('article').html() || ''
        );
        const addressText = $('.address, .sale-address, .location').text().trim();
        const images = getAllImgUrls($("body"), $);
        const dateText = $('.date, .sale-date, time').text().trim();
        const times = extractTimes(description + ' ' + dateText);

        // v4.1: Extract city from address text
        const gsfDetailCity = extractCityFromAddress(addressText) || '';

        // Try to find and enrich the matching pending sale
        const existingSale = pendingSales.find((s) => s.source_url === request.url);

        if (existingSale) {
          // ── PATH A: Enrich in-memory ──
          existingSale.description = description || existingSale.description;
          if (addressText) existingSale.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Set city if still empty
          if (!existingSale.city && gsfDetailCity) {
            existingSale.city = gsfDetailCity;
          }
          existingSale.zip = extractZip(addressText) || existingSale.zip;
          if (images.length > 0) existingSale.image_urls = images;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          // v4.2 FIX: ALWAYS try to extract date from description (override bad dates)
          const gsfDescDate = extractDateFromText(dateText || description);
          if (gsfDescDate) existingSale.date_start = gsfDescDate;
        } else {
          // ── PATH B: Direct DB update ──
          const updateData: Record<string, unknown> = {};
          if (description) updateData.description = description;
          if (addressText) updateData.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Always set city on direct updates
          if (gsfDetailCity) updateData.city = gsfDetailCity;
          const zip = extractZip(addressText);
          if (zip) updateData.zip = zip;
          if (images.length > 0) updateData.image_urls = images;
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;

          // v4.2 FIX: Always try to extract real sale date from description
          const gsfDescDate2 = extractDateFromText(dateText || description);
          if (gsfDescDate2) updateData.date_start = gsfDescDate2;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (upErr) {
              log.debug(`GSF Detail DB update failed: ${upErr.message}`);
            }
          }
        }

        sourceStats.garagesalefinder.details++;
        return;
      }

// ════════════════════════════════════════════════════════════
// END OF PART 4/6
// ════════════════════════════════════════════════════════════


      // ══════════════════════════════════════════════════════
      // HANDLER 7: YARDSALESEARCH INDEX (city listing page)
      // ══════════════════════════════════════════════════════
      if (source === 'yardsalesearch' && !request.userData.handler) {
        log.info(`[YSS Index] Processing ${request.url}`);
        sourceStats.yardsalesearch.pages++;

        const cards = $('article, .sale-listing, .sale-card, .listing, .result');
        cards.each((_, el) => {
          const $card = $(el);
          const title = $card.find('h2, h3, .title, .sale-title, a').first().text().trim();
          const link = $card.find('a').first().attr('href') || '';
          const bodyText = $card.text().trim();
          const addressText = $card.find('.address, .location').text().trim();
          const dateText = $card.find('.date, time, .sale-date').text().trim();

          if (!title || !link) return;

          const fullUrl = link.startsWith('http')
            ? link
            : `https://www.yardsalesearch.com${link}`;

          // v4.1: Extract city from yssSlug in userData (e.g. 'Winston-Salem-NC')
          const yssSlug = request.userData.yssSlug || '';
          const yssCity = extractCityFromYSSSlug(yssSlug);

          const sale: ScrapedSale = {
            source_id: link.split('/').pop()?.replace('.html', '') || '',
            title: cleanTitle(title),  // v4.2 FIX: clean title
            description: '',
            address: extractAddressFromText(addressText || bodyText) || '',
            city: yssCity || extractCityFromAddress(addressText) || '',
            state: state || '',
            zip: extractZip(addressText || bodyText) || '',
            lat: null,
            lng: null,
            date_start: extractDateFromText(dateText || bodyText),
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'yardsalesearch',
            source_url: fullUrl,
            image_urls: [],
            expires_at: null,
            scraped_at: new Date().toISOString(),
            pushed: false,
          };

          pendingSales.push(sale);
          sourceStats.yardsalesearch.listings++;
        });

        // Enqueue detail pages — v4.1: pass yssSlug to detail handler
        const detailLinks = $('a[href*="/yard-sale/"], a[href*="/sale/"]');
        const detailUrls: { url: string; userData: Record<string, string> }[] = [];
        detailLinks.each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href) return;
          const fullUrl = href.startsWith('http')
            ? href
            : `https://www.yardsalesearch.com${href}`;
          detailUrls.push({
            url: fullUrl,
            userData: {
              source: 'yardsalesearch',
              state,
              handler: 'detail',
              yssSlug: request.userData.yssSlug || '',
            },
          });
        });
        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls, { forefront: true });
        }

        // Pagination
        const currentPage = request.userData.page ? parseInt(request.userData.page, 10) : 1;
        if (currentPage < YSS_MAX_PAGES) {
          const nextUrl = $('a.next, a[rel="next"], .pagination a:contains("Next")').attr('href');
          if (nextUrl) {
            const fullNextUrl = nextUrl.startsWith('http')
              ? nextUrl
              : `https://www.yardsalesearch.com${nextUrl}`;
            await crawler.addRequests([{
              url: fullNextUrl,
              userData: {
                source: 'yardsalesearch',
                state,
                page: String(currentPage + 1),
                yssSlug: request.userData.yssSlug || '',
              },
            }]);
          }
        }

        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 8: YARDSALESEARCH DETAIL (individual sale)
      // ══════════════════════════════════════════════════════
      if (source === 'yardsalesearch' && request.userData.handler === 'detail') {
        const title = $('h1').first().text().trim();
        const description = cleanDescription(
          $('.sale-description, .description, .sale-details').html() || $('article').html() || ''
        );
        const addressText = $('.address, .sale-address, .location').text().trim();
        const images = getAllImgUrls($("body"), $);
        const dateText = $('.date, .sale-date, time').text().trim();
        const times = extractTimes(description + ' ' + dateText);

        // v4.1: Extract city from yssSlug or address text
        const yssSlug = request.userData.yssSlug || '';
        const yssDetailCity = extractCityFromYSSSlug(yssSlug) || extractCityFromAddress(addressText) || '';

        // Try to find and enrich the matching pending sale
        const existingSale = pendingSales.find((s) => s.source_url === request.url);

        if (existingSale) {
          // ── PATH A: Enrich in-memory ──
          existingSale.description = description || existingSale.description;
          if (addressText) existingSale.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Set city if still empty
          if (!existingSale.city && yssDetailCity) {
            existingSale.city = yssDetailCity;
          }
          existingSale.zip = extractZip(addressText) || existingSale.zip;
          if (images.length > 0) existingSale.image_urls = images;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          // v4.2 FIX: ALWAYS try to extract date from description (override bad dates)
          const yssDescDate = extractDateFromText(dateText || description);
          if (yssDescDate) existingSale.date_start = yssDescDate;
        } else {
          // ── PATH B: Direct DB update ──
          const updateData: Record<string, unknown> = {};
          if (description) updateData.description = description;
          if (addressText) updateData.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Always set city on direct updates
          if (yssDetailCity) updateData.city = yssDetailCity;
          const zip = extractZip(addressText);
          if (zip) updateData.zip = zip;
          if (images.length > 0) updateData.image_urls = images;
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;

          // v4.2 FIX: Always try to extract real sale date from description
          const yssDescDate2 = extractDateFromText(dateText || description);
          if (yssDescDate2) updateData.date_start = yssDescDate2;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (upErr) {
              log.debug(`YSS Detail DB update failed: ${upErr.message}`);
            }
          }
        }

        sourceStats.yardsalesearch.details++;
        return;
      }

      // ══════════════════════════════════════════════════════
      // HANDLER 9: GSALR INDEX (state listing page)
      // ══════════════════════════════════════════════════════
      if (source === 'gsalr' && !request.userData.handler) {
        log.info(`[Gsalr Index] Processing ${request.url}`);
        sourceStats.gsalr.pages++;

        const cards = $('article, .sale-listing, .sale-card, .listing, .result, .classifiedAd');
        cards.each((_, el) => {
          const $card = $(el);
          const title = $card.find('h2, h3, .title, .sale-title, a').first().text().trim();
          const link = $card.find('a').first().attr('href') || '';
          const bodyText = $card.text().trim();
          const addressText = $card.find('.address, .location').text().trim();
          const dateText = $card.find('.date, time, .sale-date').text().trim();

          if (!title || !link) return;

          const fullUrl = link.startsWith('http')
            ? link
            : `https://gsalr.com${link}`;

          // v4.1: Extract city from body text or address text
          const gsalrCity = extractCityFromAddress(addressText) || extractCityFromAddress(bodyText) || '';

          const sale: ScrapedSale = {
            source_id: link.split('/').pop()?.replace('.html', '') || '',
            title: cleanTitle(title),  // v4.2 FIX: clean title
            description: '',
            address: extractAddressFromText(addressText || bodyText) || '',
            city: gsalrCity,
            state: state || '',
            zip: extractZip(addressText || bodyText) || '',
            lat: null,
            lng: null,
            date_start: extractDateFromText(dateText || bodyText),
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'gsalr',
            source_url: fullUrl,
            image_urls: [],
            expires_at: null,
            scraped_at: new Date().toISOString(),
            pushed: false,
          };

          pendingSales.push(sale);
          sourceStats.gsalr.listings++;
        });

        // Enqueue detail pages
        await enqueueLinks({
          selector: 'a[href*="/sale/"], a[href*="/garage-sale/"]',
          userData: { source: 'gsalr', state, handler: 'detail' },
        });

        // Pagination
        const currentPage = request.userData.page ? parseInt(request.userData.page, 10) : 1;
        if (currentPage < GSALR_MAX_PAGES) {
          const nextUrl = $('a.next, a[rel="next"], .pagination a:contains("Next"), a:contains("next")').attr('href');
          if (nextUrl) {
            const fullNextUrl = nextUrl.startsWith('http')
              ? nextUrl
              : `https://gsalr.com${nextUrl}`;
            await crawler.addRequests([{
              url: fullNextUrl,
              userData: { source: 'gsalr', state, page: String(currentPage + 1) },
            }]);
          }
        }

        return;
      }

// ════════════════════════════════════════════════════════════
// END OF PART 5/6
// ════════════════════════════════════════════════════════════


      // ══════════════════════════════════════════════════════
      // HANDLER 10: GSALR DETAIL (individual sale)
      // ══════════════════════════════════════════════════════
      if (source === 'gsalr' && request.userData.handler === 'detail') {
        const title = $('h1').first().text().trim();
        const description = cleanDescription(
          $('.sale-description, .description, .sale-details, .classifiedBody').html() ||
          $('article').html() || ''
        );
        const addressText = $('.address, .sale-address, .location').text().trim();
        const images = getAllImgUrls($("body"), $);
        const dateText = $('.date, .sale-date, time').text().trim();
        const times = extractTimes(description + ' ' + dateText);

        // v4.1: Extract city from address text
        const gsalrDetailCity = extractCityFromAddress(addressText) || '';

        // Try to find and enrich the matching pending sale
        const existingSale = pendingSales.find((s) => s.source_url === request.url);

        if (existingSale) {
          // ── PATH A: Enrich in-memory ──
          existingSale.description = description || existingSale.description;
          if (addressText) existingSale.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Set city if still empty
          if (!existingSale.city && gsalrDetailCity) {
            existingSale.city = gsalrDetailCity;
          }
          existingSale.zip = extractZip(addressText) || existingSale.zip;
          if (images.length > 0) existingSale.image_urls = images;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          // v4.2 FIX: ALWAYS try to extract date from description (override bad dates)
          const gsalrDescDate = extractDateFromText(dateText || description);
          if (gsalrDescDate) existingSale.date_start = gsalrDescDate;
        } else {
          // ── PATH B: Direct DB update ──
          const updateData: Record<string, unknown> = {};
          if (description) updateData.description = description;
          if (addressText) updateData.address = extractAddressFromText(addressText) || addressText;
          // v4.1: Always set city on direct updates
          if (gsalrDetailCity) updateData.city = gsalrDetailCity;
          const zip = extractZip(addressText);
          if (zip) updateData.zip = zip;
          if (images.length > 0) updateData.image_urls = images;
          if (times.time_start) updateData.time_start = times.time_start;
          if (times.time_end) updateData.time_end = times.time_end;

          // v4.2 FIX: Always try to extract real sale date from description
          const gsalrDescDate2 = extractDateFromText(dateText || description);
          if (gsalrDescDate2) updateData.date_start = gsalrDescDate2;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (upErr) {
              log.debug(`Gsalr Detail DB update failed: ${upErr.message}`);
            }
          }
        }

        sourceStats.gsalr.details++;
        return;
      }

      // HANDLER 11: YSTM STATE DIRECTORY (discover city pages)
      // ══════════════════════════════════════════════════════
      if (source === 'ystm' && !request.url.endsWith('.html') && request.userData.handler !== 'detail') {
        log.info(`[YSTM State] Processing ${request.url}`);
        sourceStats.ystm.pages++;

        // State pages list city links: /US/Washington/Seattle.html
        const cityLinks: { url: string; userData: Record<string, any> }[] = [];
        const seenCities = new Set<string>();
        $('a[href$=".html"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href.includes('/US/')) return;
          const fullUrl = href.startsWith('http')
            ? href
            : `https://yardsaletreasuremap.com${href}`;
          if (!seenCities.has(fullUrl)) {
            seenCities.add(fullUrl);
            cityLinks.push({
              url: fullUrl,
              userData: { source: 'ystm', state, handler: 'city' },
            });
          }
        });

        if (cityLinks.length > 0) {
          await crawler.addRequests(cityLinks, { forefront: true });
          log.info(`[YSTM State] Enqueued ${cityLinks.length} city pages from ${request.url}`);
        } else {
          log.info(`[YSTM State] No city links found on ${request.url}`);
        }

        return;
      }

      // HANDLER 12: YSTM CITY PAGE (parse listings)
      // ══════════════════════════════════════════════════════
      if (source === 'ystm' && (request.userData.handler === 'city' || request.url.endsWith('.html')) && request.userData.handler !== 'detail') {
        log.info(`[YSTM City] Processing ${request.url}`);
        sourceStats.ystm.pages++;

        // Extract city name from URL: /US/Washington/Seattle.html → Seattle
        const urlParts = request.url.split('/');
        const citySlug = (urlParts[urlParts.length - 1] || '').replace('.html', '');
        const ystmCity = citySlug.replace(/-/g, ' ') || '';

        // Collect detail page links for enrichment
        const detailUrls: { url: string; userData: Record<string, any> }[] = [];
        const seenDetailUrls = new Set<string>();

        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (!href) return;
          // Skip navigation, state, and city directory links
          if (href.endsWith('/') || (href.includes('/US/') && href.endsWith('.html'))) return;
          // Match sale detail links (contain /sale/ or SaleId or saleid)
          if (href.includes('/sale/') || href.includes('SaleId') || href.includes('saleid')) {
            const fullUrl = href.startsWith('http')
              ? href
              : `https://yardsaletreasuremap.com${href}`;
            if (!seenDetailUrls.has(fullUrl)) {
              seenDetailUrls.add(fullUrl);
              detailUrls.push({
                url: fullUrl,
                userData: { source: 'ystm', state, handler: 'detail', city: ystmCity },
              });
            }
          }
        });

        // Parse listing data directly from page structure
        // YSTM renders listings as blocks with address, date, title
        let cityListingCount = 0;
        $('div, li, tr, article, section').each((_, el) => {
          const $el = $(el);
          const text = $el.text().trim();

          // Skip huge blocks (page-level containers)
          if (text.length > 800 || text.length < 20) return;

          // Look for elements containing an address pattern
          const hasAddress = /\d+\s+\w+\s+(St|Ave|Rd|Dr|Blvd|Ln|Way|Ct|Pl|Cir|Ter|Loop|Pike|Hwy|Trail|Street|Avenue|Road|Drive|Boulevard|Lane|Court|Place|Circle)/i.test(text);

          if (hasAddress) {
            // Extract address
            const addrMatch = text.match(/(\d+\s+[^,\n]+(?:St|Ave|Rd|Dr|Blvd|Ln|Way|Ct|Pl|Cir|Ter|Loop|Pike|Hwy|Trail|Street|Avenue|Road|Drive|Boulevard|Lane|Court|Place|Circle)[^,\n]*)/i);
            const address = addrMatch ? addrMatch[1].trim() : '';
            if (!address || address.length < 8) return;

            // Dedupe: check if we already saved this address
            const addrKey = address.toLowerCase().replace(/\s+/g, '');
            if (pendingSales.some((s) => s.address.toLowerCase().replace(/\s+/g, '') === addrKey && s.source === 'ystm')) return;

            // Extract date
            const dateMatch = text.match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
            const dateStr = dateMatch ? dateMatch[1] : '';

            // Extract time
            const timeMatch = text.match(/(\d{1,2}:\d{2}\s*[AaPp][Mm])/);
            const timeStr = timeMatch ? timeMatch[1] : '';

            // Extract title from first link in this element
            const titleLink = $el.find('a').first();
            const title = titleLink.text().trim() || `Yard Sale in ${ystmCity}`;
            const link = titleLink.attr('href') || '';
            const sourceUrl = link.startsWith('http')
              ? link
              : link ? `https://yardsaletreasuremap.com${link}` : request.url;

            // Build unique source_id
            const sourceId = `ystm-${address.replace(/\s+/g, '-').substring(0, 50)}-${dateStr.replace(/\//g, '')}`;

            const sale: ScrapedSale = {
              source_id: sourceId,
              title: cleanTitle(title),
              description: '',
              address: address,
              city: ystmCity,
              state: state || '',
              zip: extractZip(text) || '',
              lat: null,
              lng: null,
              date_start: extractDateFromText(dateStr || text),
              date_end: null,
              time_start: normalizeTime(timeStr) || null,
              time_end: null,
              price_range: null,
              categories: guessCategories(title + ' ' + text),
              source: 'ystm',
              source_url: sourceUrl,
              image_urls: [],
              expires_at: null,
              scraped_at: new Date().toISOString(),
              pushed: false,
            };

            pendingSales.push(sale);
            sourceStats.ystm.listings++;
            cityListingCount++;
          }
        });

        // Enqueue detail pages for enrichment (descriptions, photos)
        if (detailUrls.length > 0) {
          await crawler.addRequests(detailUrls, { forefront: true });
          log.info(`[YSTM City] Enqueued ${detailUrls.length} detail pages`);
        }

        log.info(`[YSTM City] ${cityListingCount} listings from ${ystmCity}`);
        return;
      }

      // HANDLER 13: YSTM DETAIL PAGE (enrichment — photos, description)
      // ══════════════════════════════════════════════════════
      if (source === 'ystm' && request.userData.handler === 'detail') {
        log.info(`[YSTM Detail] Processing ${request.url}`);
        sourceStats.ystm.details++;

        // Extract description
        const descText = $('div.description, .sale-description, [itemprop="description"]').first().text().trim()
          || $('p').map((_, el) => $(el).text().trim()).get().join(' ').substring(0, 1000);
        const description = cleanDescription(descText || '');

        // Extract photos
        const photos: string[] = [];
        $('img').each((_, el) => {
          const src = $(el).attr('src') || $(el).attr('data-src') || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('avatar')
              && !src.includes('banner') && !src.includes('spacer') && !src.includes('pixel')
              && (src.includes('sale') || src.includes('photo') || src.includes('image')
              || src.includes('upload') || src.includes('img') || src.includes('pic'))) {
            const fullSrc = src.startsWith('http') ? src : `https://yardsaletreasuremap.com${src}`;
            if (!photos.includes(fullSrc)) photos.push(fullSrc);
          }
        });

        // Extract address from detail page
        const addrEl = $('[itemprop="streetAddress"], .address, .sale-address, .location').first();
        const detailAddress = addrEl.text().trim() || extractAddressFromText($('body').text()) || '';
        const city = request.userData.city || extractCityFromAddress(detailAddress) || '';

        // Try to find and update existing sale in pendingSales
        const existingIdx = pendingSales.findIndex((s) => s.source_url === request.url);
        if (existingIdx >= 0) {
          if (description) pendingSales[existingIdx].description = description;
          if (photos.length > 0) pendingSales[existingIdx].image_urls = photos;
          if (detailAddress && !pendingSales[existingIdx].address) pendingSales[existingIdx].address = detailAddress;
          if (city && !pendingSales[existingIdx].city) pendingSales[existingIdx].city = city;
          const detailDate = extractDateFromText(description);
          if (detailDate) pendingSales[existingIdx].date_start = detailDate;
        } else {
          // ── PATH B: Direct DB update ──
          const bodyText = $('body').text();
          const dateStart = extractDateFromText(bodyText);

          const updateData: Record<string, any> = {};
          if (description) updateData.description = description;
          if (photos.length > 0) updateData.image_urls = photos;
          if (detailAddress) updateData.address = detailAddress;
          if (city) updateData.city = city;
          if (dateStart) updateData.date_start = dateStart;

          if (Object.keys(updateData).length > 0) {
            const { error } = await supabase
              .from('yard_sales')
              .update(updateData)
              .eq('source_url', request.url);
            if (error) log.debug(`[YSTM Detail] DB update failed: ${error.message}`);
          }
        }

        return;
      }

      // ══════════════════════════════════════════════════════
      // UNHANDLED SOURCE — log and skip
      // ══════════════════════════════════════════════════════
      log.debug(`Unhandled request: ${request.url} (source: ${source})`);

    }, // end requestHandler

    async failedRequestHandler({ request }, error) {
      const { source } = request.userData as { source: string };
      log.warning(`Request failed: ${request.url} (source: ${source}) — ${error?.message || 'unknown'}`);
    },
  }); // end CheerioCrawler constructor

  // ── Periodic batch save during crawl ──
  const batchSaveInterval = setInterval(async () => {
    if (pendingSales.length >= SAVE_BATCH_SIZE) {
      const batch = pendingSales.splice(0, SAVE_BATCH_SIZE);
      await saveBatchToSupabase(batch);
      totalProcessed += batch.length;
      log.info(`Batch saved ${batch.length} sales (total processed: ${totalProcessed})`);
    }
  }, 2000);

  // ══════════════════════════════════════════════════════
  // RUN THE CRAWLER
  // ══════════════════════════════════════════════════════
  // v4.6: Fisher-Yates shuffle — randomize start URLs so interrupted runs
  // cover different states each time instead of always starting at Alabama
  for (let i = startUrls.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [startUrls[i], startUrls[j]] = [startUrls[j], startUrls[i]];
 }
   log.info('Starting CityScraper v4.6 crawl (shuffled URLs)...');
   await crawler.run(startUrls);


   // Stop the batch save interval
  clearInterval(batchSaveInterval);

  // ── Final save: flush any remaining pending sales ──
  if (pendingSales.length > 0) {
    await saveBatchToSupabase(pendingSales);
    totalProcessed += pendingSales.length;
    log.info(`Final batch saved ${pendingSales.length} remaining sales.`);
  }

  // ── Summary stats ──
  const elapsed = ((Date.now() - crawlStartTime) / 1000 / 60).toFixed(1);
  log.info('══════════════════════════════════════════════════');
  log.info(`CityScraper v4.1 — Crawl Complete`);
  log.info(`Total processed: ${totalProcessed} | Elapsed: ${elapsed} min`);
  log.info('── Source Breakdown ──');
  for (const [src, stats] of Object.entries(sourceStats)) {
    log.info(`  ${src}: ${stats.listings} listings, ${stats.details} details, ${stats.pages} pages`);
  }
  log.info('══════════════════════════════════════════════════');

  // ── Post-crawl cleanup ──
  await postCrawlAddressCleanup();
  await postCrawlGeocode();

  log.info('Post-crawl tasks complete. CityScraper v4.1 finished.');
}

// ══════════════════════════════════════════════════════════════
// ENTRY POINT
// ══════════════════════════════════════════════════════════════
const crawlStartTime = Date.now();

main().catch((err) => {
  log.error(`CityScraper v4.1 fatal error: ${err.message}`);
  process.exit(1);
});

// ════════════════════════════════════════════════════════════
// END OF PART 6/6 — FILE COMPLETE
// ════════════════════════════════════════════════════════════
