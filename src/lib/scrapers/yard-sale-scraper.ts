import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '@/lib/supabase';
import PQueue from 'p-queue';

// ============================================================
//  YARD SALE SCRAPER — Powers YardShoppers.com
//  Sources: Craigslist, Yard Sale Search, GSALR, EstateSales.net
//  Collects: title, description, address, dates, categories
// ============================================================

export interface YardSaleItem {
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
  price_range: string | null;
  categories: string[];
  source: string;
  source_url: string;
  image_urls: string[];
}

// Rate-limited queue — 2 requests per second max
const queue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 2 });

// Rotating user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// US state abbreviations and major cities for scraping targets
const SCRAPE_TARGETS = [
  { state: 'WA', cities: ['seattle', 'olympia', 'tacoma', 'spokane', 'vancouver'] },
  { state: 'OR', cities: ['portland', 'eugene', 'salem', 'bend'] },
  { state: 'CA', cities: ['losangeles', 'sfbay', 'sandiego', 'sacramento', 'fresno'] },
  { state: 'TX', cities: ['houston', 'dallas', 'austin', 'sanantonio'] },
  { state: 'FL', cities: ['miami', 'tampa', 'orlando', 'jacksonville'] },
  { state: 'NY', cities: ['newyork', 'albany', 'buffalo', 'rochester'] },
  { state: 'IL', cities: ['chicago', 'springfield', 'peoria'] },
  { state: 'PA', cities: ['philadelphia', 'pittsburgh', 'harrisburg'] },
  { state: 'OH', cities: ['cleveland', 'columbus', 'cincinnati'] },
  { state: 'GA', cities: ['atlanta', 'savannah', 'augusta'] },
  { state: 'NC', cities: ['charlotte', 'raleigh', 'greensboro'] },
  { state: 'MI', cities: ['detroit', 'grandrapids', 'annarbor'] },
  { state: 'AZ', cities: ['phoenix', 'tucson', 'flagstaff'] },
  { state: 'CO', cities: ['denver', 'coloradosprings', 'boulder'] },
  { state: 'TN', cities: ['nashville', 'memphis', 'knoxville'] },
];

// ---------- CRAIGSLIST SCRAPER ----------

async function scrapeCraigslistCity(city: string, state: string): Promise<YardSaleItem[]> {
  const items: YardSaleItem[] = [];

  try {
    const url = `https://${city}.craigslist.org/search/gms`; // garage & moving sales
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUA() },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $('li.cl-static-search-result, .result-row').each((_, el) => {
      const titleEl = $(el).find('.title, .result-title');
      const title = titleEl.text().trim();
      const link = titleEl.attr('href') || $(el).find('a').attr('href') || '';
      const metaEl = $(el).find('.meta, .result-meta');
      const dateText = metaEl.find('time, .date').attr('datetime') || metaEl.find('time, .date').text().trim();
      const locationText = $(el).find('.location, .result-hood').text().trim().replace(/[()]/g, '');

      if (title) {
        items.push({
          title,
          description: '',
          address: locationText || city,
          city: city.replace(/[^a-zA-Z]/g, ' ').trim(),
          state,
          zip: '',
          lat: null,
          lng: null,
          date_start: dateText || new Date().toISOString().split('T')[0],
          date_end: null,
          price_range: null,
          categories: detectCategories(title),
          source: 'craigslist',
          source_url: link.startsWith('http') ? link : `https://${city}.craigslist.org${link}`,
          image_urls: [],
        });
      }
    });
  } catch (err: any) {
    console.error(`[YardSale] Craigslist ${city} error: ${err.message}`);
  }

  return items;
}

// ---------- GSALR / YARD SALE SEARCH SCRAPER ----------

async function scrapeGSALR(state: string): Promise<YardSaleItem[]> {
  const items: YardSaleItem[] = [];

  try {
    const url = `https://gsalr.com/${state.toLowerCase()}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUA() },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $('.sale, .listing, article').each((_, el) => {
      const title = $(el).find('h2, h3, .title').text().trim();
      const desc = $(el).find('.description, p').text().trim();
      const address = $(el).find('.address, .location').text().trim();
      const dateText = $(el).find('.date, time').text().trim();
      const link = $(el).find('a').attr('href') || '';
      const imgSrc = $(el).find('img').attr('src') || '';

      if (title && title.length > 5) {
        items.push({
          title,
          description: desc.substring(0, 500),
          address: address || 'Unknown',
          city: extractCity(address),
          state,
          zip: extractZip(address),
          lat: null,
          lng: null,
          date_start: parseDate(dateText),
          date_end: null,
          price_range: null,
          categories: detectCategories(`${title} ${desc}`),
          source: 'gsalr',
          source_url: link.startsWith('http') ? link : `https://gsalr.com${link}`,
          image_urls: imgSrc ? [imgSrc] : [],
        });
      }
    });
  } catch (err: any) {
    console.error(`[YardSale] GSALR ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- ESTATE SALES SCRAPER ----------

async function scrapeEstateSales(state: string): Promise<YardSaleItem[]> {
  const items: YardSaleItem[] = [];

  try {
    const url = `https://www.estatesales.net/find-sale/${state}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUA() },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $('.sale-item, .saleCard, .listing-card').each((_, el) => {
      const title = $(el).find('.sale-title, h3, h2').text().trim();
      const company = $(el).find('.company-name, .hosted-by').text().trim();
      const address = $(el).find('.address, .sale-location').text().trim();
      const dateText = $(el).find('.sale-dates, .dates').text().trim();
      const link = $(el).find('a').attr('href') || '';
      const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

      if (title) {
        items.push({
          title: `Estate Sale: ${title}`,
          description: company ? `Hosted by ${company}` : '',
          address,
          city: extractCity(address),
          state,
          zip: extractZip(address),
          lat: null,
          lng: null,
          date_start: parseDate(dateText),
          date_end: null,
          price_range: null,
          categories: ['estate sale'],
          source: 'estatesales.net',
          source_url: link.startsWith('http') ? link : `https://www.estatesales.net${link}`,
          image_urls: imgSrc ? [imgSrc] : [],
        });
      }
    });
  } catch (err: any) {
    console.error(`[YardSale] EstateSales ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- MAIN SCRAPE FUNCTION ----------

export async function scrapeYardSales(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  console.log('[YardSale] Starting full scrape...');
  const startTime = Date.now();
  let totalItems = 0;
  let totalErrors = 0;
  const allItems: YardSaleItem[] = [];

  // Scrape all targets with rate limiting
  for (const target of SCRAPE_TARGETS) {
    // Craigslist cities
    for (const city of target.cities) {
      const items = await queue.add(() => scrapeCraigslistCity(city, target.state));
      if (items) {
        allItems.push(...items);
      }
    }

    // GSALR by state
    const gsalrItems = await queue.add(() => scrapeGSALR(target.state));
    if (gsalrItems) {
      allItems.push(...gsalrItems);
    }

    // Estate sales by state
    const estateItems = await queue.add(() => scrapeEstateSales(target.state));
    if (estateItems) {
      allItems.push(...estateItems);
    }
  }

  // Deduplicate by title + city + date
  const seen = new Set<string>();
  const uniqueItems = allItems.filter((item) => {
    const key = `${item.title.toLowerCase().substring(0, 50)}-${item.city.toLowerCase()}-${item.date_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Upsert to Supabase
  if (uniqueItems.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < uniqueItems.length; i += batchSize) {
      const batch = uniqueItems.slice(i, i + batchSize).map((item) => ({
        ...item,
        scraped_at: new Date().toISOString(),
        pushed: false,
      }));

      const { error } = await supabaseAdmin
        .from('yard_sales')
        .upsert(batch, { onConflict: 'source_url' });

      if (error) {
        console.error(`[YardSale] Upsert batch error:`, error);
        totalErrors++;
      } else {
        totalItems += batch.length;
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[YardSale] Scrape complete: ${totalItems} items, ${totalErrors} errors, ${duration}ms`);

  return {
    success: totalErrors === 0,
    itemsFound: totalItems,
    errors: totalErrors,
    details: `Scraped ${SCRAPE_TARGETS.length} states, ${totalItems} unique yard sales in ${(duration / 1000).toFixed(1)}s`,
  };
}

// ---------- UTILITY FUNCTIONS ----------

function detectCategories(text: string): string[] {
  const cats: string[] = [];
  const lower = text.toLowerCase();

  const catMap: Record<string, string[]> = {
    'furniture': ['furniture', 'couch', 'sofa', 'table', 'chair', 'desk', 'dresser', 'bed', 'mattress'],
    'electronics': ['electronics', 'tv', 'computer', 'laptop', 'phone', 'speaker', 'gaming', 'console'],
    'clothing': ['clothing', 'clothes', 'shoes', 'jacket', 'dress', 'shirt', 'pants'],
    'tools': ['tools', 'drill', 'saw', 'wrench', 'hammer', 'power tool', 'workshop'],
    'kids': ['kids', 'toys', 'baby', 'children', 'stroller', 'crib', 'toddler'],
    'kitchen': ['kitchen', 'appliance', 'cookware', 'dishes', 'pots', 'pans'],
    'outdoor': ['outdoor', 'garden', 'patio', 'lawn', 'grill', 'bbq', 'camping'],
    'sports': ['sports', 'bicycle', 'bike', 'golf', 'fishing', 'exercise', 'gym'],
    'books': ['books', 'dvd', 'cd', 'vinyl', 'records', 'media'],
    'antiques': ['antique', 'vintage', 'collectible', 'retro'],
    'auto': ['auto', 'car', 'motorcycle', 'truck', 'parts', 'tires'],
    'moving sale': ['moving', 'everything must go', 'downsizing', 'relocating'],
    'estate sale': ['estate'],
    'multi-family': ['multi-family', 'multi family', 'neighborhood', 'block sale', 'community'],
  };

  for (const [category, keywords] of Object.entries(catMap)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      cats.push(category);
    }
  }

  return cats.length > 0 ? cats : ['general'];
}

function extractCity(address: string): string {
  const parts = address.split(',').map((p) => p.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || 'Unknown';
}

function extractZip(address: string): string {
  const match = address.match(/\b\d{5}(-\d{4})?\b/);
  return match ? match[0] : '';
}

function parseDate(dateStr: string): string {
  try {
    if (!dateStr) return new Date().toISOString().split('T')[0];
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}
