// ============================================================
// FILE: scripts/crawlee-deep-scraper.ts (CityScraper project)
// CREATE this NEW file (create the scripts/ folder first)
//
// This is the LOCAL deep scraper powered by Crawlee.
// It runs on your PC (not Vercel) and has NO time limit.
// It uses ScraperAPI as a proxy for blocked sites.
//
// RUN: npx ts-node scripts/crawlee-deep-scraper.ts
// OR:  npx tsx scripts/crawlee-deep-scraper.ts
//
// ENV VARS REQUIRED (in .env.local):
//   SCRAPER_API_KEY=your_key_here
//   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
//   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//
// INSTALL FIRST:
//   npm install crawlee cheerio dotenv @supabase/supabase-js
//   npm install --save-dev @types/cheerio
// ============================================================

import { CheerioCrawler, ProxyConfiguration, RequestQueue, log } from 'crawlee';
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

// ── ADDRESS VALIDATION (hard gate) ──
function hasValidAddress(text: string): boolean {
  return /^\d+\s+[A-Za-z]/.test(text.trim());
}

function extractAddressFromText(text: string): string | null {
  const match = text.match(/(\d+\s+[A-Za-z][\w\s]*(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle|Pkwy|Parkway|Hwy|Highway)[^,]*(?:,\s*[A-Za-z\s]+)?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?)/i);
  return match ? match[1].trim() : null;
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
  if (cats.length === 0) cats.push('Garage Sale');
  return cats;
}

// ── CRAIGSLIST CITIES (all 50 states) ──
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

// ── BUILD START URLs ──
function buildStartUrls(): { url: string; userData: { source: string; state: string } }[] {
  const urls: { url: string; userData: { source: string; state: string } }[] = [];

  // Craigslist search pages
  for (const [state, cities] of Object.entries(CRAIGSLIST_CITIES)) {
    for (const city of cities) {
      urls.push({
        url: `https://${city}.craigslist.org/search/gms`,
        userData: { source: 'craigslist', state },
      });
    }
  }

  // EstateSales.net state pages
  for (const state of ESTATE_SALES_STATES) {
    urls.push({
      url: `https://www.estatesales.net/${state}`,
      userData: { source: 'estatesales', state: state.replace(/-/g, ' ') },
    });
  }

  // GarageSaleFinder state pages
  for (const state of GSF_STATES) {
    urls.push({
      url: `https://www.garagesalefinder.com/sale/${state}`,
      userData: { source: 'garagesalefinder', state: state.replace(/-/g, ' ') },
    });
  }

  // YardSaleSearch (free, no proxy needed usually)
  const yssCities = [
    'Seattle-WA','Portland-OR','Los-Angeles-CA','San-Francisco-CA',
    'Chicago-IL','Houston-TX','Dallas-TX','Phoenix-AZ','Atlanta-GA',
    'Miami-FL','Denver-CO','New-York-NY','Philadelphia-PA','Boston-MA',
    'Nashville-TN','Charlotte-NC','Detroit-MI','Minneapolis-MN',
    'Tampa-FL','Orlando-FL','Austin-TX','San-Diego-CA','Sacramento-CA',
    'Olympia-WA','Tacoma-WA',
  ];
  for (const city of yssCities) {
    urls.push({
      url: `https://www.yardsalesearch.com/garage-sales-in-${city}.html`,
      userData: { source: 'yardsalesearch', state: city.split('-').pop() || '' },
    });
  }

  return urls;
}

// ── SUPABASE BATCH SAVE ──
async function saveBatchToSupabase(sales: ScrapedSale[]): Promise<number> {
  if (sales.length === 0) return 0;
  let saved = 0;
  const batchSize = 50;

  for (let i = 0; i < sales.length; i += batchSize) {
    const batch = sales.slice(i, i + batchSize);
    const { error } = await supabase
      .from('yard_sales')
      .upsert(batch, { onConflict: 'source_url' });

    if (error) {
      console.error(`[Supabase] Upsert error: ${error.message}`);
    } else {
      saved += batch.length;
    }
  }
  return saved;
}

// ══════════════════════════════════════════════
//  MAIN CRAWLEE RUNNER
// ══════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CRAWLEE DEEP SCRAPER v1.0');
  console.log(`  ScraperAPI: ${SCRAPER_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  Supabase: ${SUPABASE_URL ? 'Connected' : 'MISSING'}`);
  console.log('═══════════════════════════════════════════════════════');

  const startUrls = buildStartUrls();
  console.log(`Total start URLs: ${startUrls.length}`);

  // Configure ScraperAPI as proxy (if key exists)
  let proxyConfiguration: ProxyConfiguration | undefined;
  if (SCRAPER_API_KEY) {
    proxyConfiguration = new ProxyConfiguration({
      proxyUrls: [
        `http://scraperapi:${SCRAPER_API_KEY}@proxy-server.scraperapi.com:8001`,
      ],
    });
    console.log('ScraperAPI proxy configured');
  }

  const allSales: ScrapedSale[] = [];
  const seenIds = new Set<string>();
  let totalProcessed = 0;
  let totalSkipped = 0;

  const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxConcurrency: 5,            // 5 parallel requests
    maxRequestRetries: 2,         // Retry failed requests twice
    requestHandlerTimeoutSecs: 60,
    navigationTimeoutSecs: 45,

    async requestHandler({ request, $, log: crawlLog }) {
      const { source, state } = request.userData as { source: string; state: string };
      totalProcessed++;

      if (source === 'craigslist') {
        // ── CRAIGSLIST PARSER ──
        $('li.cl-static-search-result, .result-row, .cl-search-result').each((_, el) => {
          const titleEl = $(el).find('.title, .result-title, .titlestring, .posting-title .label');
          const title = titleEl.text().trim();
          if (!title) return;

          const linkEl = titleEl.closest('a').length ? titleEl.closest('a') : $(el).find('a').first();
          const link = linkEl.attr('href') || '';
          if (!link) return;

          const locationText = $(el).find('.location, .result-hood').text().trim().replace(/[()]/g, '');
          const address = extractAddressFromText(locationText + ' ' + title) || locationText;
          const dateText = $(el).find('time').attr('datetime') || '';
          const priceText = $(el).find('.price, .result-price').text().trim();
          const imgSrc = $(el).find('img').attr('src') || '';

          const sourceUrl = link.startsWith('http') ? link : `https://craigslist.org${link}`;
          const sourceId = `cl-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          allSales.push({
            source_id: sourceId,
            title,
            description: locationText,
            address: address || '',
            city: '',
            state,
            zip: '',
            lat: null,
            lng: null,
            date_start: dateText ? dateText.split('T')[0] : new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null,
            time_end: null,
            price_range: priceText || null,
            categories: guessCategories(title),
            source: 'craigslist',
            source_url: sourceUrl,
            image_urls: imgSrc ? [imgSrc] : [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });
        });

      } else if (source === 'estatesales') {
        // ── ESTATESALES.NET PARSER ──
        // Try JSON-LD first
        $('script[type="application/ld+json"]').each((_, el) => {
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

              const fullUrl = eventUrl.startsWith('http') ? eventUrl : `https://www.estatesales.net${eventUrl}`;
              const sourceId = `es-deep-${fullUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

              if (seenIds.has(sourceId)) return;
              seenIds.add(sourceId);

              allSales.push({
                source_id: sourceId,
                title: name,
                description: desc,
                address: addr.streetAddress || '',
                city: addr.addressLocality || '',
                state: addr.addressRegion || state,
                zip: addr.postalCode || '',
                lat: loc.geo?.latitude ? parseFloat(loc.geo.latitude) : null,
                lng: loc.geo?.longitude ? parseFloat(loc.geo.longitude) : null,
                date_start: event.startDate ? event.startDate.split('T')[0] : new Date().toISOString().split('T')[0],
                date_end: event.endDate ? event.endDate.split('T')[0] : null,
                time_start: null,
                time_end: null,
                price_range: null,
                categories: ['Estate Sale'],
                source: 'estatesales.net',
                source_url: fullUrl,
                image_urls: event.image ? (Array.isArray(event.image) ? event.image : [event.image]) : [],
                expires_at: event.endDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                scraped_at: new Date().toISOString(),
                pushed: false,
              });
            }
          } catch { /* skip bad JSON-LD */ }
        });

        // Fallback: HTML cards
        $('.sale-item, .saleCard, .listing-card').each((_, el) => {
          const title = $(el).find('.sale-title, h3, h2, .title').first().text().trim();
          const address = $(el).find('.address, .sale-location, .location').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.estatesales.net${link}`;
          const sourceId = `es-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          allSales.push({
            source_id: sourceId,
            title: `Estate Sale: ${title}`,
            description: '',
            address,
            city: '',
            state,
            zip: '',
            lat: null, lng: null,
            date_start: new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null, time_end: null,
            price_range: null,
            categories: ['Estate Sale'],
            source: 'estatesales.net',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });
        });

      } else if (source === 'garagesalefinder') {
        // ── GARAGESALEFINDER PARSER ──
        $('div[class*="saleListing"], div[class*="sale-listing"], .listing-item').each((_, el) => {
          const title = $(el).find('h2, h3, h4, a strong, a b').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.garagesalefinder.com${link}`;
          const sourceId = `gsf-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';

          allSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '', state,
            zip: '',
            lat: null, lng: null,
            date_start: new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null, time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'garagesalefinder.com',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });
        });

        // Fallback: any anchors with sale links
        $('a[href*="/sale/"]').each((_, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr('href') || '';
          if (!title || title.length < 5 || !link.match(/\/sale\/\d/)) return;
          const fullLink = link.startsWith('http') ? link : `https://www.garagesalefinder.com${link}`;
          const sourceId = `gsf-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          allSales.push({
            source_id: sourceId,
            title,
            description: '',
            address: '', city: '', state,
            zip: '',
            lat: null, lng: null,
            date_start: new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null, time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'garagesalefinder.com',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });
        });

      } else if (source === 'yardsalesearch') {
        // ── YARDSALESEARCH PARSER ──
        $('div[class*="listing"], .sale-listing, .result-item').each((_, el) => {
          const title = $(el).find('h2, h3, h4, strong, b').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.yardsalesearch.com${link}`;
          const sourceId = `yss-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';

          allSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '', state,
            zip: '',
            lat: null, lng: null,
            date_start: new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null, time_end: null,
            price_range: null,
            categories: guessCategories(title),
            source: 'yardsalesearch.com',
            source_url: fullLink,
            image_urls: [],
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            scraped_at: new Date().toISOString(),
            pushed: false,
          });
        });
      }

      // Save every 200 sales to avoid losing data
      if (allSales.length > 0 && allSales.length % 200 < 10) {
        const batch = allSales.splice(0, allSales.length);
        const saved = await saveBatchToSupabase(batch);
        console.log(`[Checkpoint] Saved ${saved} sales to Supabase (${seenIds.size} total unique)`);
      }

      if (totalProcessed % 50 === 0) {
        console.log(`[Progress] Processed ${totalProcessed} pages, ${seenIds.size} unique sales found`);
      }
    },

    async failedRequestHandler({ request, error }) {
      totalSkipped++;
      console.warn(`[Failed] ${request.url}: ${error?.message || 'Unknown error'}`);
    },
  });

  // Add all start URLs
  console.log(`Adding ${startUrls.length} URLs to queue...`);
  await crawler.addRequests(startUrls);

  // Run the crawler
  console.log('Starting Crawlee...');
  const startTime = Date.now();
  await crawler.run();
  const duration = (Date.now() - startTime) / 1000;

  // Save remaining sales
  if (allSales.length > 0) {
    const saved = await saveBatchToSupabase(allSales);
    console.log(`[Final] Saved remaining ${saved} sales`);
  }

  console.log('═══════════════════════════════════════════════════════');
  console.log('  CRAWLEE DEEP SCRAPER COMPLETE');
  console.log(`  Pages processed: ${totalProcessed}`);
  console.log(`  Pages failed: ${totalSkipped}`);
  console.log(`  Unique sales found: ${seenIds.size}`);
  console.log(`  Duration: ${duration.toFixed(1)}s (${(duration / 60).toFixed(1)} min)`);
  console.log('═══════════════════════════════════════════════════════');
}

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
