// ============================================================
// FILE: scripts/crawlee-deep-scraper.ts (CityScraper project)
// REPLACES: scripts/crawlee-deep-scraper.ts
//
// CRAWLEE DEEP SCRAPER v3.0 — MAXIMUM COVERAGE EDITION
//
// CHANGES FROM v2.3:
//   1. NEW SOURCE: Gsalr.com — 50 states × 3 pages (ScraperAPI-only)
//   2. NEW CL QUERIES: estate+sale, moving+sale sub-searches (826 more URLs)
//   3. Total URLs: ~4,348 → ~5,324+
//
// ALL v2.3 FEATURES STILL INCLUDED:
//   - 413 CL subdomains with /gms + /sss dual URLs
//   - 274 YardSaleSearch cities × 5 pages
//   - 50 EstateSales.net states × 5 pages
//   - 50 GarageSaleFinder states × 5 pages
//   - Verbose logging per URL
//   - 2s delay between requests
//   - CL 3 pages max
//   - Concurrency = 2
//   - Save every 25 sales (save-first)
//   - 2 retries
//   - Per-source counters
//   - Detail page crawling on all sources
//   - Craigslist dual URL (/gms + /sss)
//   - Post-crawl geocoding via Nominatim
//   - Broad CSS selectors with fallbacks
//   - ScraperAPI country_code=us
//   - Purge on start
//
// RUN: npx tsx scripts/crawlee-deep-scraper.ts
//
// ENV VARS REQUIRED (in .env.local):
//   SCRAPER_API_KEY=your_key_here
//   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
//   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//
// INSTALL (same as before):
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
const GEOCODE_USER_AGENT = 'CityScraper/3.0 (cityscraper.org)';

// ── v2.2: REDUCED PAGINATION ──
const CL_MAX_PAGES = 3;         // Was 10 → now 3 (freshest listings)
const ES_MAX_PAGES = 5;
const GSF_MAX_PAGES = 5;
const YSS_MAX_PAGES = 5;

// ── v2.2: SMALLER SAVE BATCHES ──
const SAVE_BATCH_SIZE = 25;     // Was 100 → now 25

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

// ── v2.2: PER-SOURCE COUNTERS ──
const sourceStats: Record<string, { success: number; failed: number; listings: number }> = {
  craigslist: { success: 0, failed: 0, listings: 0 },
  estatesales: { success: 0, failed: 0, listings: 0 },
  garagesalefinder: { success: 0, failed: 0, listings: 0 },
  yardsalesearch: { success: 0, failed: 0, listings: 0 },
  gsalr: { success: 0, failed: 0, listings: 0 },
};

// ── ADDRESS VALIDATION (hard gate) ──
function hasValidAddress(text: string): boolean {
  return /^\d+\s+[A-Za-z]/.test(text.trim());
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

// ── TIME EXTRACTION ──
function extractTimes(text: string): { time_start: string | null; time_end: string | null } {
  const rangeMatch = text.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))\s*[-–to]+\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
  if (rangeMatch) {
    return { time_start: rangeMatch[1].trim(), time_end: rangeMatch[2].trim() };
  }
  const singleMatch = text.match(/(?:starts?\s+(?:at\s+)?|opens?\s+(?:at\s+)?|from\s+)(\d{1,2}(?::\d{2})?\s*(?:am|pm|AM|PM))/i);
  if (singleMatch) {
    return { time_start: singleMatch[1].trim(), time_end: null };
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
  // Alabama
  'Birmingham-AL','Huntsville-AL','Mobile-AL','Montgomery-AL','Tuscaloosa-AL',
  // Alaska
  'Anchorage-AK','Fairbanks-AK',
  // Arizona
  'Phoenix-AZ','Tucson-AZ','Mesa-AZ','Scottsdale-AZ','Chandler-AZ','Flagstaff-AZ',
  // Arkansas
  'Little-Rock-AR','Fayetteville-AR','Fort-Smith-AR',
  // California
  'Los-Angeles-CA','San-Francisco-CA','San-Diego-CA','Sacramento-CA','San-Jose-CA',
  'Fresno-CA','Bakersfield-CA','Riverside-CA','Oakland-CA','Long-Beach-CA',
  'Stockton-CA','Modesto-CA','Santa-Rosa-CA','Irvine-CA','Santa-Barbara-CA',
  // Colorado
  'Denver-CO','Colorado-Springs-CO','Aurora-CO','Fort-Collins-CO','Boulder-CO','Pueblo-CO',
  // Connecticut
  'Hartford-CT','New-Haven-CT','Stamford-CT','Bridgeport-CT','Waterbury-CT',
  // Delaware
  'Wilmington-DE','Dover-DE',
  // DC
  'Washington-DC',
  // Florida
  'Miami-FL','Tampa-FL','Orlando-FL','Jacksonville-FL','Fort-Lauderdale-FL',
  'St-Petersburg-FL','Tallahassee-FL','Sarasota-FL','Pensacola-FL','Daytona-Beach-FL',
  'Fort-Myers-FL','Gainesville-FL','Lakeland-FL','Cape-Coral-FL',
  // Georgia
  'Atlanta-GA','Savannah-GA','Augusta-GA','Athens-GA','Macon-GA','Columbus-GA',
  // Hawaii
  'Honolulu-HI',
  // Idaho
  'Boise-ID','Idaho-Falls-ID','Nampa-ID',
  // Illinois
  'Chicago-IL','Springfield-IL','Peoria-IL','Naperville-IL','Rockford-IL','Champaign-IL',
  // Indiana
  'Indianapolis-IN','Fort-Wayne-IN','Evansville-IN','South-Bend-IN','Bloomington-IN',
  // Iowa
  'Des-Moines-IA','Cedar-Rapids-IA','Davenport-IA','Iowa-City-IA','Sioux-City-IA',
  // Kansas
  'Wichita-KS','Kansas-City-KS','Topeka-KS','Overland-Park-KS','Lawrence-KS',
  // Kentucky
  'Louisville-KY','Lexington-KY','Bowling-Green-KY','Owensboro-KY',
  // Louisiana
  'New-Orleans-LA','Baton-Rouge-LA','Shreveport-LA','Lafayette-LA','Lake-Charles-LA',
  // Maine
  'Portland-ME','Bangor-ME','Augusta-ME',
  // Maryland
  'Baltimore-MD','Annapolis-MD','Frederick-MD','Rockville-MD','Silver-Spring-MD',
  // Massachusetts
  'Boston-MA','Worcester-MA','Springfield-MA','Cambridge-MA','Lowell-MA',
  // Michigan
  'Detroit-MI','Grand-Rapids-MI','Ann-Arbor-MI','Lansing-MI','Flint-MI',
  'Kalamazoo-MI','Traverse-City-MI',
  // Minnesota
  'Minneapolis-MN','St-Paul-MN','Duluth-MN','Rochester-MN','Bloomington-MN',
  // Mississippi
  'Jackson-MS','Gulfport-MS','Hattiesburg-MS','Biloxi-MS',
  // Missouri
  'Kansas-City-MO','St-Louis-MO','Springfield-MO','Columbia-MO','Independence-MO',
  // Montana
  'Billings-MT','Missoula-MT','Great-Falls-MT','Bozeman-MT','Helena-MT',
  // Nebraska
  'Omaha-NE','Lincoln-NE','Grand-Island-NE',
  // Nevada
  'Las-Vegas-NV','Reno-NV','Henderson-NV','Sparks-NV',
  // New Hampshire
  'Manchester-NH','Nashua-NH','Concord-NH',
  // New Jersey
  'Newark-NJ','Jersey-City-NJ','Trenton-NJ','Edison-NJ','Toms-River-NJ','Cherry-Hill-NJ',
  // New Mexico
  'Albuquerque-NM','Santa-Fe-NM','Las-Cruces-NM','Rio-Rancho-NM',
  // New York
  'New-York-NY','Buffalo-NY','Rochester-NY','Albany-NY','Syracuse-NY',
  'Yonkers-NY','Utica-NY','Ithaca-NY','Binghamton-NY',
  // North Carolina
  'Charlotte-NC','Raleigh-NC','Greensboro-NC','Durham-NC','Wilmington-NC',
  'Fayetteville-NC','Asheville-NC','Winston-Salem-NC',
  // North Dakota
  'Fargo-ND','Bismarck-ND','Grand-Forks-ND','Minot-ND',
  // Ohio
  'Columbus-OH','Cleveland-OH','Cincinnati-OH','Dayton-OH','Toledo-OH',
  'Akron-OH','Canton-OH','Youngstown-OH',
  // Oklahoma
  'Oklahoma-City-OK','Tulsa-OK','Norman-OK','Broken-Arrow-OK','Edmond-OK',
  // Oregon
  'Portland-OR','Eugene-OR','Salem-OR','Bend-OR','Medford-OR','Corvallis-OR',
  // Pennsylvania
  'Philadelphia-PA','Pittsburgh-PA','Harrisburg-PA','Allentown-PA','Erie-PA',
  'Reading-PA','Scranton-PA','Lancaster-PA','York-PA',
  // Rhode Island
  'Providence-RI','Warwick-RI','Cranston-RI',
  // South Carolina
  'Charleston-SC','Columbia-SC','Greenville-SC','Myrtle-Beach-SC','Rock-Hill-SC',
  // South Dakota
  'Sioux-Falls-SD','Rapid-City-SD','Aberdeen-SD',
  // Tennessee
  'Nashville-TN','Memphis-TN','Knoxville-TN','Chattanooga-TN','Clarksville-TN',
  'Murfreesboro-TN',
  // Texas
  'Houston-TX','Dallas-TX','Austin-TX','San-Antonio-TX','Fort-Worth-TX',
  'El-Paso-TX','Arlington-TX','Plano-TX','Lubbock-TX','Corpus-Christi-TX',
  'Laredo-TX','Amarillo-TX','Waco-TX','Midland-TX',
  // Utah
  'Salt-Lake-City-UT','Provo-UT','Ogden-UT','St-George-UT','Logan-UT',
  // Vermont
  'Burlington-VT','Rutland-VT',
  // Virginia
  'Virginia-Beach-VA','Richmond-VA','Norfolk-VA','Chesapeake-VA',
  'Arlington-VA','Roanoke-VA','Lynchburg-VA','Charlottesville-VA',
  // Washington
  'Seattle-WA','Olympia-WA','Tacoma-WA','Spokane-WA','Bellingham-WA',
  'Vancouver-WA','Yakima-WA','Kennewick-WA','Everett-WA',
  // West Virginia
  'Charleston-WV','Huntington-WV','Morgantown-WV','Parkersburg-WV',
  // Wisconsin
  'Milwaukee-WI','Madison-WI','Green-Bay-WI','Appleton-WI','Kenosha-WI','Eau-Claire-WI',
  // Wyoming
  'Cheyenne-WY','Casper-WY',
];

// ── GSALR.COM STATES (v3.0 NEW SOURCE — ScraperAPI-only, 403 without proxy) ──
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

// ── BUILD START URLs ──
function buildStartUrls(): { url: string; userData: { source: string; state: string; pageType: string } }[] {
  const urls: { url: string; userData: { source: string; state: string; pageType: string } }[] = [];

  // ── CRAIGSLIST: /search/gms + /search/sss — v2.2: only 3 pages ──
  for (const [state, cities] of Object.entries(CRAIGSLIST_CITIES)) {
    for (const city of cities) {
      // Primary: garage/moving sales category — page 1
      urls.push({
        url: `https://${city}.craigslist.org/search/gms`,
        userData: { source: 'craigslist', state, pageType: 'index' },
      });
      // Secondary: keyword search — page 1
      urls.push({
        url: `https://${city}.craigslist.org/search/sss?query=yard+sale+garage+sale`,
        userData: { source: 'craigslist', state, pageType: 'index' },
      });
      // Pagination for /gms (pages 2-3 only)
      for (let page = 1; page < CL_MAX_PAGES; page++) {
        urls.push({
          url: `https://${city}.craigslist.org/search/gms?s=${page * 120}`,
          userData: { source: 'craigslist', state, pageType: 'index' },
        });
      }
      // Pagination for /sss (pages 2-3 only)
      for (let page = 1; page < CL_MAX_PAGES; page++) {
        urls.push({
          url: `https://${city}.craigslist.org/search/sss?query=yard+sale+garage+sale&s=${page * 120}`,
          userData: { source: 'craigslist', state, pageType: 'index' },
        });
      }

      // v3.0 NEW: estate sale + moving sale sub-queries (page 1 only)
      urls.push({
        url: `https://${city}.craigslist.org/search/sss?query=estate+sale`,
        userData: { source: 'craigslist', state, pageType: 'index' },
      });
      urls.push({
        url: `https://${city}.craigslist.org/search/sss?query=moving+sale`,
        userData: { source: 'craigslist', state, pageType: 'index' },
      });
    }
  }

  // ── ESTATESALES.NET ──
  for (const state of ESTATE_SALES_STATES) {
    urls.push({
      url: `https://www.estatesales.net/${state}`,
      userData: { source: 'estatesales', state: state.replace(/-/g, ' '), pageType: 'index' },
    });
    for (let page = 2; page <= ES_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.estatesales.net/${state}?page=${page}`,
        userData: { source: 'estatesales', state: state.replace(/-/g, ' '), pageType: 'index' },
      });
    }
  }

  // ── GARAGESALEFINDER ──
  for (const state of GSF_STATES) {
    urls.push({
      url: `https://www.garagesalefinder.com/sale/${state}`,
      userData: { source: 'garagesalefinder', state: state.replace(/-/g, ' '), pageType: 'index' },
    });
    for (let page = 2; page <= GSF_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.garagesalefinder.com/sale/${state}?page=${page}`,
        userData: { source: 'garagesalefinder', state: state.replace(/-/g, ' '), pageType: 'index' },
      });
    }
  }

  // ── YARDSALESEARCH ──
  for (const city of YSS_CITIES) {
    urls.push({
      url: `https://www.yardsalesearch.com/garage-sales-in-${city}.html`,
      userData: { source: 'yardsalesearch', state: city.split('-').pop() || '', pageType: 'index' },
    });
    for (let page = 2; page <= YSS_MAX_PAGES; page++) {
      urls.push({
        url: `https://www.yardsalesearch.com/garage-sales-in-${city}.html?page=${page}`,
        userData: { source: 'yardsalesearch', state: city.split('-').pop() || '', pageType: 'index' },
      });
    }
  }

  // ── v3.0 NEW: GSALR.COM (ScraperAPI proxy required — 403 without it) ──
  if (SCRAPER_API_KEY) {
    for (const state of GSALR_STATES) {
      urls.push({
        url: `https://gsalr.com/garage-sales-in/${state}/`,
        userData: { source: 'gsalr', state: state.replace(/-/g, ' '), pageType: 'index' },
      });
      for (let page = 2; page <= GSALR_MAX_PAGES; page++) {
        urls.push({
          url: `https://gsalr.com/garage-sales-in/${state}/page/${page}/`,
          userData: { source: 'gsalr', state: state.replace(/-/g, ' '), pageType: 'index' },
        });
      }
    }
    console.log(`[Gsalr] Added ${GSALR_STATES.length * GSALR_MAX_PAGES} URLs (ScraperAPI proxy)`);
  } else {
    console.log('[Gsalr] SKIPPED — requires SCRAPER_API_KEY (site blocks direct access)');
  }

  return urls;
}

// ── SUPABASE BATCH SAVE — IMMEDIATE ──
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
      console.error(`  ❌ [Supabase] Upsert error: ${error.message}`);
    } else {
      saved += batch.length;
    }
  }
  return saved;
}

// ══════════════════════════════════════════════
//  MAIN CRAWLEE RUNNER — v2.2
// ══════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  CRAWLEE DEEP SCRAPER v3.0 — MAXIMUM COVERAGE EDITION');
  console.log('  NEW: Gsalr.com 5th source, CL estate+moving queries,');
  console.log('       all v2.3 features preserved');
  console.log(`  ScraperAPI: ${SCRAPER_API_KEY ? 'ENABLED' : 'DISABLED'}`);
  console.log(`  Supabase: ${SUPABASE_URL ? 'Connected' : 'MISSING'}`);
  console.log(`  Geocoding: POST-CRAWL (runs after all pages scraped)`);
  console.log('═══════════════════════════════════════════════════════');

  // Purge old Crawlee state
  console.log('Purging old Crawlee storage state...');
  await purgeDefaultStorages();
  console.log('Storage purged — all URLs will be processed fresh.\n');

  const startUrls = buildStartUrls();

  // Count URLs by source
  const urlCounts: Record<string, number> = {};
  for (const u of startUrls) {
    const src = u.userData.source;
    urlCounts[src] = (urlCounts[src] || 0) + 1;
  }
  console.log(`Total start URLs: ${startUrls.length}`);
  for (const [src, count] of Object.entries(urlCounts)) {
    console.log(`  ${src}: ${count} URLs`);
  }

  // ScraperAPI proxy
  let proxyConfiguration: ProxyConfiguration | undefined;
  if (SCRAPER_API_KEY) {
    proxyConfiguration = new ProxyConfiguration({
      proxyUrls: [
        `http://scraperapi.country_code=us:${SCRAPER_API_KEY}@proxy-server.scraperapi.com:8001`,
      ],
    });
    console.log('ScraperAPI proxy configured (country_code=us)\n');
  } else {
    console.warn('⚠️  No SCRAPER_API_KEY — running without proxy (CL will likely block)\n');
  }

  // ── TRACKING ──
  const pendingSales: ScrapedSale[] = [];
  const seenIds = new Set<string>();
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalDetailPages = 0;
  let totalSaved = 0;

  const crawler = new CheerioCrawler({
    proxyConfiguration,

    // v2.2: Lower concurrency — 2 instead of 5
    // Prevents ScraperAPI rate limit cascade failures
    maxConcurrency: 2,

    // v2.2: 2 retries with longer timeout
    maxRequestRetries: 2,
    requestHandlerTimeoutSecs: 120,
    navigationTimeoutSecs: 90,

    // v2.2: 2 second delay between requests
    // This is the key fix — Craigslist detects rapid-fire and blocks
    minConcurrency: 1,

    async requestHandler({ request, $, addRequests }) {
      const { source, state, pageType } = request.userData as {
        source: string;
        state: string;
        pageType: string;
      };
      totalProcessed++;

      // v2.2: Verbose per-URL logging
      const shortUrl = request.url.replace(/https?:\/\/(www\.)?/, '').slice(0, 70);
      const beforeCount = seenIds.size;

      // ═══════════════════════════════════════
      // CRAIGSLIST
      // ═══════════════════════════════════════
      if (source === 'craigslist' && pageType === 'index') {
        const detailUrls: string[] = [];

        $('li.cl-static-search-result, .result-row, .cl-search-result, .cl-search-result-item').each((_, el) => {
          const titleEl = $(el).find('.title, .result-title, .titlestring, .posting-title .label, .cl-app-anchor .label');
          const title = titleEl.text().trim();
          if (!title) return;

          const linkEl = titleEl.closest('a').length ? titleEl.closest('a') : $(el).find('a').first();
          const link = linkEl.attr('href') || '';
          if (!link) return;

          const sourceUrl = link.startsWith('http') ? link : `https://${request.url.split('/')[2]}${link}`;
          const sourceId = `cl-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const locationText = $(el).find('.location, .result-hood, .subreddit').text().trim().replace(/[()]/g, '');
          const address = extractAddressFromText(locationText + ' ' + title) || locationText;
          const dateText = $(el).find('time').attr('datetime') || '';
          const priceText = $(el).find('.price, .result-price, .priceinfo').text().trim();
          const imgSrc = $(el).find('img').attr('src') || '';

          pendingSales.push({
            source_id: sourceId,
            title,
            description: locationText,
            address: address || '',
            city: '',
            state,
            zip: extractZip(locationText),
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

          // Enqueue detail page
          if (sourceUrl.includes('/d/') || sourceUrl.match(/\/\d+\.html/)) {
            detailUrls.push(sourceUrl);
          }
        });

        if (detailUrls.length > 0) {
          await addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'craigslist', state, pageType: 'detail' },
          })));
          totalDetailPages += detailUrls.length;
        }

        const newListings = seenIds.size - beforeCount;
        sourceStats.craigslist.success++;
        sourceStats.craigslist.listings += newListings;
        console.log(`  ✅ [CL] ${shortUrl} → ${newListings} listings, ${detailUrls.length} detail pages enqueued`);

      } else if (source === 'craigslist' && pageType === 'detail') {
        const sourceUrl = request.url;
        const sourceId = `cl-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('#postingbody, .posting-body, .body, section.body').text().trim();
        const mapAddress = $('div.mapaddress, .mapAndAttrs .mapaddress').text().trim();
        const geoLat = $('[data-latitude]').attr('data-latitude');
        const geoLng = $('[data-longitude]').attr('data-longitude');
        const allImages: string[] = [];
        $('img[src*="images.craigslist"], .gallery img, #thumbs a').each((_, img) => {
          const src = $(img).attr('src') || $(img).attr('href') || '';
          if (src && !src.includes('00T0T')) allImages.push(src.replace(/\/\d+x\d+_/, '/600x450_'));
        });

        const times = extractTimes(bodyText);
        const detailDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (mapAddress && hasValidAddress(mapAddress)) existingSale.address = mapAddress;
          if (!existingSale.address || !hasValidAddress(existingSale.address)) {
            const foundAddr = extractAddressFromText(bodyText);
            if (foundAddr) existingSale.address = foundAddr;
          }
          if (bodyText) existingSale.description = bodyText.slice(0, 2000);
          if (geoLat && geoLng) {
            existingSale.lat = parseFloat(geoLat);
            existingSale.lng = parseFloat(geoLng);
          }
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (detailDate && !existingSale.date_start) existingSale.date_start = detailDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText + ' ' + mapAddress);
          console.log(`  📝 [CL detail] enriched: ${existingSale.title.slice(0, 50)}`);
        } else {
          console.log(`  ⚪ [CL detail] no match in memory: ${shortUrl}`);
        }

      // ═══════════════════════════════════════
      // ESTATESALES.NET
      // ═══════════════════════════════════════
      } else if (source === 'estatesales' && pageType === 'index') {
        const detailUrls: string[] = [];

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

              if (seenIds.has(sourceId)) continue;
              seenIds.add(sourceId);

              pendingSales.push({
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

              if (fullUrl.includes('estatesales.net/')) detailUrls.push(fullUrl);
            }
          } catch { /* skip bad JSON-LD */ }
        });

        // Fallback HTML cards
        $('.sale-item, .saleCard, .listing-card, .es-card, [class*="saleCard"], [class*="sale-card"], .sale-list-item').each((_, el) => {
          const title = $(el).find('.sale-title, h3, h2, .title, [class*="sale-title"], [class*="saleTitle"]').first().text().trim();
          const address = $(el).find('.address, .sale-location, .location, [class*="address"], [class*="location"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.estatesales.net${link}`;
          const sourceId = `es-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const imgSrc = $(el).find('img').first().attr('src') || '';
          const dateText = $(el).find('.date, .sale-date, [class*="date"]').first().text().trim();
          const parsedDate = extractDateFromText(dateText);

          pendingSales.push({
            source_id: sourceId,
            title: `Estate Sale: ${title}`,
            description: '',
            address,
            city: '',
            state,
            zip: extractZip(address),
            lat: null, lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: null, time_end: null,
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

        if (detailUrls.length > 0) {
          await addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'estatesales', state, pageType: 'detail' },
          })));
          totalDetailPages += detailUrls.length;
        }

        const newListings = seenIds.size - beforeCount;
        sourceStats.estatesales.success++;
        sourceStats.estatesales.listings += newListings;
        console.log(`  ✅ [ES] ${shortUrl} → ${newListings} listings, ${detailUrls.length} detail pages`);

      } else if (source === 'estatesales' && pageType === 'detail') {
        const sourceUrl = request.url;
        const sourceId = `es-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const fullAddress = $('.full-address, .sale-address, [class*="address"], [itemprop="streetAddress"]').text().trim();
        const cityEl = $('[itemprop="addressLocality"]').text().trim();
        const stateEl = $('[itemprop="addressRegion"]').text().trim();
        const zipEl = $('[itemprop="postalCode"]').text().trim();
        const description = $('.sale-description, .description, [class*="description"]').text().trim();
        const allImages: string[] = [];
        $('.sale-photo img, .photo-gallery img, [class*="gallery"] img, [class*="photo"] img').each((_, img) => {
          const src = $(img).attr('src') || '';
          if (src) allImages.push(src);
        });
        const dateSection = $('.sale-dates, .dates, [class*="date"]').text().trim();
        const times = extractTimes(dateSection);
        const parsedDate = extractDateFromText(dateSection);

        if (existingSale) {
          if (fullAddress && hasValidAddress(fullAddress)) existingSale.address = fullAddress;
          if (cityEl) existingSale.city = cityEl;
          if (stateEl) existingSale.state = stateEl;
          if (zipEl) existingSale.zip = zipEl;
          if (description) existingSale.description = description.slice(0, 2000);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          console.log(`  📝 [ES detail] enriched: ${existingSale.title.slice(0, 50)}`);
        }

      // ═══════════════════════════════════════
      // GARAGESALEFINDER
      // ═══════════════════════════════════════
      } else if (source === 'garagesalefinder' && pageType === 'index') {
        const detailUrls: string[] = [];

        $('div[class*="saleListing"], div[class*="sale-listing"], div[class*="SaleListing"], .listing-item, .sale-item, .garage-sale-item, [class*="listingCard"]').each((_, el) => {
          const title = $(el).find('h2, h3, h4, a strong, a b, .sale-title, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.garagesalefinder.com${link}`;
          const sourceId = `gsf-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = $(el).find('img').first().attr('src') || '';
          const dateText = $(el).find('.date, [class*="date"]').text().trim();
          const parsedDate = extractDateFromText(dateText);
          const times = extractTimes(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '', state,
            zip: extractZip(bodyText),
            lat: null, lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start, time_end: times.time_end,
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
        $('a[href*="/sale/"]').each((_, el) => {
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

          detailUrls.push(fullLink);
        });

        if (detailUrls.length > 0) {
          await addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'garagesalefinder', state, pageType: 'detail' },
          })));
          totalDetailPages += detailUrls.length;
        }

        const newListings = seenIds.size - beforeCount;
        sourceStats.garagesalefinder.success++;
        sourceStats.garagesalefinder.listings += newListings;
        console.log(`  ✅ [GSF] ${shortUrl} → ${newListings} listings, ${detailUrls.length} detail pages`);

      } else if (source === 'garagesalefinder' && pageType === 'detail') {
        const sourceUrl = request.url;
        const sourceId = `gsf-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], #sale-details, .details').text().trim();
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img').each((_, img) => {
          const src = $(img).attr('src') || '';
          if (src && !src.includes('logo') && !src.includes('icon')) allImages.push(src);
        });
        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          if (description) existingSale.description = description.slice(0, 2000);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [GSF detail] enriched: ${existingSale.title.slice(0, 50)}`);
        }

      // ═══════════════════════════════════════
      // YARDSALESEARCH
      // ═══════════════════════════════════════
      } else if (source === 'yardsalesearch' && pageType === 'index') {
        const detailUrls: string[] = [];

        $('div[class*="listing"], div[class*="Listing"], .sale-listing, .result-item, .sale-item, .yard-sale-item, [class*="saleResult"]').each((_, el) => {
          const title = $(el).find('h2, h3, h4, strong, b, .title, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          const fullLink = link.startsWith('http') ? link : `https://www.yardsalesearch.com${link}`;
          const sourceId = `yss-deep-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (!title || title.length < 5 || seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = $(el).find('img').first().attr('src') || '';
          const times = extractTimes(bodyText);
          const parsedDate = extractDateFromText(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '', state,
            zip: extractZip(bodyText),
            lat: null, lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start, time_end: times.time_end,
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
          await addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'yardsalesearch', state, pageType: 'detail' },
          })));
          totalDetailPages += detailUrls.length;
        }

        const newListings = seenIds.size - beforeCount;
        sourceStats.yardsalesearch.success++;
        sourceStats.yardsalesearch.listings += newListings;
        console.log(`  ✅ [YSS] ${shortUrl} → ${newListings} listings, ${detailUrls.length} detail pages`);

      } else if (source === 'yardsalesearch' && pageType === 'detail') {
        const sourceUrl = request.url;
        const sourceId = `yss-deep-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], .details, #details').text().trim();
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img').each((_, img) => {
          const src = $(img).attr('src') || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner')) allImages.push(src);
        });
        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          if (description) existingSale.description = description.slice(0, 2000);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [YSS detail] enriched: ${existingSale.title.slice(0, 50)}`);
        }

      // ═══════════════════════════════════════
      // GSALR.COM (v3.0 NEW SOURCE)
      // ═══════════════════════════════════════
      } else if (source === 'gsalr' && pageType === 'index') {
        const detailUrls: string[] = [];

        // Gsalr listing cards
        $('div.sale, .sale-listing, .listing, article, .result, .sale-item, [class*="sale"], [class*="listing"]').each((_, el) => {
          const title = $(el).find('h2, h3, h4, .title, a strong, a b, [class*="title"]').first().text().trim();
          const link = $(el).find('a').first().attr('href') || '';
          if (!title || title.length < 5 || title.length > 300) return;

          const fullLink = link.startsWith('http') ? link : `https://gsalr.com${link}`;
          const sourceId = `gsalr-${fullLink.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;

          if (seenIds.has(sourceId)) return;
          seenIds.add(sourceId);

          const bodyText = $(el).text();
          const address = extractAddressFromText(bodyText) || '';
          const imgSrc = $(el).find('img').first().attr('src') || '';
          const times = extractTimes(bodyText);
          const parsedDate = extractDateFromText(bodyText);

          pendingSales.push({
            source_id: sourceId,
            title,
            description: '',
            address,
            city: '', state,
            zip: extractZip(bodyText),
            lat: null, lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start, time_end: times.time_end,
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
        $('a[href*="/sale"], a[href*="/garage-sale"]').each((_, el) => {
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
            city: '', state,
            zip: extractZip(bodyText),
            lat: null, lng: null,
            date_start: parsedDate || new Date().toISOString().split('T')[0],
            date_end: null,
            time_start: times.time_start, time_end: times.time_end,
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
          await addRequests(detailUrls.map(url => ({
            url,
            userData: { source: 'gsalr', state, pageType: 'detail' },
          })));
          totalDetailPages += detailUrls.length;
        }

        const newListings = seenIds.size - beforeCount;
        sourceStats.gsalr.success++;
        sourceStats.gsalr.listings += newListings;
        console.log(`  ✅ [GSALR] ${shortUrl} → ${newListings} listings, ${detailUrls.length} detail pages`);

      } else if (source === 'gsalr' && pageType === 'detail') {
        const sourceUrl = request.url;
        const sourceId = `gsalr-${sourceUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-30)}`;
        const existingSale = pendingSales.find(s => s.source_id === sourceId);

        const bodyText = $('body').text();
        const detailAddress = extractAddressFromText(bodyText);
        const description = $('.sale-description, .description, [class*="description"], .details, #details').text().trim();
        const allImages: string[] = [];
        $('img[src*="sale"], img[src*="photo"], .photo img, .gallery img').each((_, img) => {
          const src = $(img).attr('src') || '';
          if (src && !src.includes('logo') && !src.includes('icon') && !src.includes('banner')) allImages.push(src);
        });
        const times = extractTimes(bodyText);
        const parsedDate = extractDateFromText(bodyText);

        if (existingSale) {
          if (detailAddress && hasValidAddress(detailAddress)) existingSale.address = detailAddress;
          if (description) existingSale.description = description.slice(0, 2000);
          if (allImages.length > 0) existingSale.image_urls = allImages;
          if (times.time_start) existingSale.time_start = times.time_start;
          if (times.time_end) existingSale.time_end = times.time_end;
          if (parsedDate) existingSale.date_start = parsedDate;
          existingSale.zip = existingSale.zip || extractZip(bodyText);
          console.log(`  📝 [GSALR detail] enriched: ${existingSale.title.slice(0, 50)}`);
        }
      }

      // ═══════════════════════════════════════
      //  SAVE IMMEDIATELY — every 25 sales
      // ═══════════════════════════════════════
      if (pendingSales.length >= SAVE_BATCH_SIZE) {
        const batch = pendingSales.splice(0, pendingSales.length);
        const saved = await saveBatchToSupabase(batch);
        totalSaved += saved;
        console.log(`  💾 [Save] ${saved} sales saved to Supabase (${totalSaved} total, ${seenIds.size} unique found)`);
      }

      // Progress log every 25 pages
      if (totalProcessed % 25 === 0) {
        const elapsed = ((Date.now() - crawlStartTime) / 1000 / 60).toFixed(1);
        console.log(`\n  ═══ [Progress] ${totalProcessed} pages | ${totalDetailPages} detail | ${seenIds.size} unique | ${totalSaved} saved | ${totalSkipped} failed | ${elapsed} min ═══\n`);
      }

      // v2.2: Delay between requests — critical for CL
      await new Promise(resolve => setTimeout(resolve, 2000));
    },

    async failedRequestHandler({ request, error }) {
      totalSkipped++;
      const { source } = request.userData as { source: string };
      if (sourceStats[source]) sourceStats[source].failed++;

      // v2.2: Log EVERY failure so you can see what's happening
      const shortUrl = request.url.replace(/https?:\/\/(www\.)?/, '').slice(0, 70);
      const errMsg = (error as Error)?.message?.slice(0, 80) || 'Unknown error';
      console.log(`  ❌ [FAIL #${totalSkipped}] [${source}] ${shortUrl} — ${errMsg}`);
    },
  });

  // Add all start URLs
  console.log(`Adding ${startUrls.length} URLs to queue...`);
  await crawler.addRequests(startUrls);

  // Run the crawler
  console.log('Starting Crawlee v2.3...\n');
  const crawlStartTime = Date.now();
  await crawler.run();

  // Save any remaining sales
  if (pendingSales.length > 0) {
    const saved = await saveBatchToSupabase(pendingSales);
    totalSaved += saved;
    console.log(`  💾 [Final Save] ${saved} remaining sales saved (${totalSaved} total)`);
    pendingSales.length = 0;
  }

  const crawlDuration = (Date.now() - crawlStartTime) / 1000;

  // v2.2: Per-source breakdown
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  CRAWL PHASE COMPLETE — SOURCE BREAKDOWN');
  console.log('═══════════════════════════════════════════════════════');
  for (const [src, stats] of Object.entries(sourceStats)) {
    console.log(`  ${src.toUpperCase()}: ${stats.success} pages OK, ${stats.failed} failed, ${stats.listings} listings`);
  }
  console.log('───────────────────────────────────────────────────────');
  console.log(`  Total pages crawled: ${totalProcessed}`);
  console.log(`  Total detail pages: ${totalDetailPages}`);
  console.log(`  Total pages failed: ${totalSkipped}`);
  console.log(`  Unique sales found: ${seenIds.size}`);
  console.log(`  Sales saved to Supabase: ${totalSaved}`);
  console.log(`  Crawl duration: ${crawlDuration.toFixed(1)}s (${(crawlDuration / 60).toFixed(1)} min)`);
  console.log('═══════════════════════════════════════════════════════');

  // POST-CRAWL GEOCODING
  const geocoded = await postCrawlGeocode();

  const totalDuration = (Date.now() - crawlStartTime) / 1000;

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  CRAWLEE DEEP SCRAPER v3.0 — ALL DONE');
  console.log(`  Sales saved: ${totalSaved}`);
  console.log(`  Sales geocoded: ${geocoded}`);
  console.log(`  Total duration: ${totalDuration.toFixed(1)}s (${(totalDuration / 60).toFixed(1)} min)`);
  console.log('═══════════════════════════════════════════════════════');
}

// Declare crawlStartTime at module level for use in requestHandler
let crawlStartTime = Date.now();

// Run
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
