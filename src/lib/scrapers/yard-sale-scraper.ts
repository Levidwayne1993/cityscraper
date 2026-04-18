import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '@/lib/supabase';
import PQueue from 'p-queue';
import {
  type RawListing,
  type NormalizedSale,
  normalizeListing,
  normalizeAll,
  extractAddress,
  extractCity,
  scorePage,
  hasPrimaryKeyword,
} from './yard-sale-normalizer';

// ================================================================
//  YARD SALE SCRAPER v3 — ULTIMATE EDITION
//  Powered by merged YardShoppers + CityScraper normalizer
//
//  Sources: Craigslist (175+ cities), GSALR (50 states),
//           EstateSales.net (50 states)
//
//  HARD GATE: Every listing MUST have a real street address
//  starting with a number. No address = rejected.
// ================================================================

const queue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 2 });

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

const ALL_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA',
  'HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
  'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
  'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

const CRAIGSLIST_CITIES: Record<string, string[]> = {
  AL: ['birmingham','huntsville','mobile','montgomery','tuscaloosa'],
  AK: ['anchorage','fairbanks','kenai'],
  AZ: ['phoenix','tucson','flagstaff','prescott','yuma','mohave'],
  AR: ['littlerock','fayar','fortsmith','jonesboro','texarkana'],
  CA: ['losangeles','sfbay','sandiego','sacramento','fresno','bakersfield','inlandempire','orangecounty','ventura','stockton','modesto','santabarbara','redding','humboldt','merced'],
  CO: ['denver','coloradosprings','boulder','fortcollins','pueblo','westslope'],
  CT: ['hartford','newhaven','newlondon','easternct'],
  DE: ['delaware'],
  FL: ['miami','tampa','orlando','jacksonville','fortlauderdale','pensacola','sarasota','lakeland','daytona','gainesville','fortmyers','tallahassee','treasure','spacecoast','ocala','panamacity'],
  GA: ['atlanta','savannah','augusta','macon','athens','valdosta','statesboro','brunswick'],
  HI: ['honolulu'],
  ID: ['boise','eastidaho','twinfalls','lewiston','pullman'],
  IL: ['chicago','springfieldil','peoria','chambana','rockford','carbondale','decatur'],
  IN: ['indianapolis','fortwayne','southbend','evansville','bloomington','muncie','lafayette'],
  IA: ['desmoines','cedarrapids','waterloo','iowacity','dubuque','siouxcity','ames'],
  KS: ['kansascity','wichita','topeka','lawrence','manhattan','salina'],
  KY: ['louisville','lexington','bgky','eastky','owensboro'],
  LA: ['neworleans','batonrouge','shreveport','lafayette','lakecharles','monroe','alexandria'],
  ME: ['maine'],
  MD: ['baltimore','frederick','easternshore','annapolis','smd','westmd'],
  MA: ['boston','worcester','capecod','westernmass','southcoast'],
  MI: ['detroit','grandrapids','annarbor','lansing','flint','kalamazoo','muskegon','saginaw','battlecreek','upperpeninsula'],
  MN: ['minneapolis','duluth','stcloud','mankato','rochestermn','bemidji','brainerd'],
  MS: ['jackson','gulfport','hattiesburg','meridian','northmiss'],
  MO: ['stlouis','kansascity','springfield','columbiamo','joplin','semo','stjoseph'],
  MT: ['billings','missoula','greatfalls','helena','bozeman','butte','kalispell'],
  NE: ['omaha','lincoln','grandisland','northplatte','scottsbluff'],
  NV: ['lasvegas','reno','elko'],
  NH: ['nh'],
  NJ: ['newjersey','jerseyshore','southjersey','centralnj','northjersey'],
  NM: ['albuquerque','santafe','lascruces','roswell','farmington'],
  NY: ['newyork','albany','buffalo','rochester','syracuse','longisland','hudsonvalley','ithaca','utica','binghamton','watertown','plattsburgh','oneonta','elmira'],
  NC: ['charlotte','raleigh','greensboro','asheville','wilmington','fayetteville','hickory','outerbanks','boone','jacksonvillenc'],
  ND: ['fargo','bismarck','grandforks'],
  OH: ['cleveland','columbus','cincinnati','dayton','toledo','akroncanton','youngstown','mansfield','sandusky','zanesville','chillicothe','lima'],
  OK: ['oklahomacity','tulsa','lawton','stillwater'],
  OR: ['portland','eugene','salem','bend','medford','corvallis','roseburg','klamath','oregoncoast','eastoregon'],
  PA: ['philadelphia','pittsburgh','harrisburg','allentown','erie','scranton','lancaster','reading','york','williamsport','altoona','poconos','meadville','chambersburg','statecollege'],
  RI: ['providence'],
  SC: ['charleston','columbia','greenville','myrtlebeach','hiltonhead','florence'],
  SD: ['siouxfalls','rapidcity','pierre','aberdeen'],
  TN: ['nashville','memphis','knoxville','chattanooga','tricities','clarksville','cookeville','jackson'],
  TX: ['houston','dallas','austin','sanantonio','fortworth','elpaso','mcallen','corpuschristi','lubbock','amarillo','waco','killeen','beaumont','brownsville','laredo','tyler','abilene','sanangelo','texoma','nacogdoches'],
  UT: ['saltlakecity','provo','ogden','stgeorge','logan'],
  VT: ['burlington'],
  VA: ['norfolk','richmond','roanoke','charlottesville','fredericksburg','danville','harrisonburg','lynchburg','blacksburg','winchester'],
  WA: ['seattle','olympia','tacoma','spokane','bellingham','yakima','wenatchee','kpr','pullman','skagit','moseslake'],
  WV: ['charlestonwv','morgantown','huntington','parkersburg','wheeling'],
  WI: ['milwaukee','madison','greenbay','appleton','lacrosse','eauclaire','wausau','janesville','racine','kenosha','sheboygan'],
  WY: ['wyoming'],
};

// ── Safe HTTP GET with retries ──

async function safeFetch(url: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000,
        maxRedirects: 3,
      });
      return response.data;
    } catch (err: any) {
      if (attempt === retries) {
        console.error(`[YardSale] Failed ${url}: ${err.message}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return null;
}

// ── CRAIGSLIST ──

async function scrapeCraigslistCity(city: string, state: string): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const html = await safeFetch(`https://${city}.craigslist.org/search/gms`);
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

// ── GSALR ──

async function scrapeGSALR(state: string): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const html = await safeFetch(`https://gsalr.com/${state.toLowerCase()}`);
  if (!html) return listings;

  const $ = cheerio.load(html);

  $('.sale, .listing, article, .sale-listing, .result-item, [class*="sale"]').each((_, el) => {
    const title = $(el).find('h2, h3, h4, .title, .sale-title').first().text().trim();
    if (!title) return;

    const desc = $(el).find('.description, .details, p, .sale-description').first().text().trim();
    const address = $(el).find('.address, .location, .sale-address, .sale-location').first().text().trim();
    const dateText = $(el).find('.date, time, .sale-date, .sale-dates').first().text().trim();

    const link = $(el).find('a').first().attr('href') || '';
    const fullLink = link.startsWith('http') ? link : `https://gsalr.com${link}`;
    const imgSrc = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';

    listings.push({
      title,
      description: desc.substring(0, 2000),
      address,
      city: extractCity(address) || undefined,
      state,
      date: dateText,
      time: desc,
      sourceUrl: fullLink,
      sourceName: 'gsalr',
      sourceCategory: 'yardsale-directory',
      photos: imgSrc ? [imgSrc] : [],
    });
  });

  return listings;
}

// ── ESTATESALES.NET ──

async function scrapeEstateSales(state: string): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const html = await safeFetch(`https://www.estatesales.net/${state}`);
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

// ── MAIN EXPORT ──

export async function scrapeYardSales(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  console.log('[YardSale] ═══════════════════════════════════════════');
  console.log('[YardSale] SCRAPER v3 — Ultimate Edition');
  console.log('[YardSale] Address hard gate ACTIVE — street number required');
  console.log('[YardSale] ═══════════════════════════════════════════');

  const startTime = Date.now();
  let totalErrors = 0;
  const allRawListings: RawListing[] = [];

  // PHASE 1: Collect raw listings from all sources
  for (const state of ALL_STATES) {
    const cities = CRAIGSLIST_CITIES[state] || [];
    for (const city of cities) {
      try {
        const items = await queue.add(() => scrapeCraigslistCity(city, state));
        if (items && items.length > 0) {
          allRawListings.push(...items);
          console.log(`[YardSale] CL ${city} (${state}): ${items.length} raw`);
        }
      } catch (err: any) {
        console.error(`[YardSale] CL ${city} error: ${err.message}`);
        totalErrors++;
      }
    }

    try {
      const items = await queue.add(() => scrapeGSALR(state));
      if (items && items.length > 0) {
        allRawListings.push(...items);
        console.log(`[YardSale] GSALR ${state}: ${items.length} raw`);
      }
    } catch (err: any) {
      console.error(`[YardSale] GSALR ${state} error: ${err.message}`);
      totalErrors++;
    }

    try {
      const items = await queue.add(() => scrapeEstateSales(state));
      if (items && items.length > 0) {
        allRawListings.push(...items);
        console.log(`[YardSale] EstateSales ${state}: ${items.length} raw`);
      }
    } catch (err: any) {
      console.error(`[YardSale] EstateSales ${state} error: ${err.message}`);
      totalErrors++;
    }
  }

  console.log(`[YardSale] ── PHASE 1: ${allRawListings.length} raw listings collected ──`);

  // PHASE 2: Normalize + filter + dedup
  const validSales = normalizeAll(allRawListings);

  console.log(`[YardSale] ── PHASE 2 ──`);
  console.log(`[YardSale]   Raw:      ${allRawListings.length}`);
  console.log(`[YardSale]   Valid:    ${validSales.length}`);
  console.log(`[YardSale]   Rejected: ${allRawListings.length - validSales.length} (no address / junk / dupe)`);

  // PHASE 3: Upsert to Supabase
  let totalSaved = 0;

  if (validSales.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < validSales.length; i += batchSize) {
      const batch = validSales.slice(i, i + batchSize).map(toSupabaseRow);
      const { error } = await supabaseAdmin
        .from('yard_sales')
        .upsert(batch, { onConflict: 'source_url' });

      if (error) {
        console.error(`[YardSale] Upsert batch ${Math.floor(i / batchSize) + 1} error:`, error.message);
        totalErrors++;
      } else {
        totalSaved += batch.length;
      }
    }
  }

  const duration = Date.now() - startTime;

  console.log(`[YardSale] ═══════════════════════════════════════════`);
  console.log(`[YardSale] COMPLETE: ${totalSaved} saved, ${totalErrors} errors, ${(duration / 1000).toFixed(1)}s`);
  console.log(`[YardSale] ═══════════════════════════════════════════`);

  return {
    success: totalErrors === 0,
    itemsFound: totalSaved,
    errors: totalErrors,
    details: `50 states, ${Object.values(CRAIGSLIST_CITIES).flat().length} CL cities | Raw: ${allRawListings.length} → Valid: ${validSales.length} → Saved: ${totalSaved} | ${(duration / 1000).toFixed(1)}s`,
  };
}
