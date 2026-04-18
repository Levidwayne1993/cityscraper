// ============================================================
// FILE: src/lib/scrapers/home-sources/portals.ts
// REAL ESTATE PORTAL SOURCES — v3.0 (April 2026)
//
// WHAT CHANGED FROM v2.3:
// 1. Realtor.com — RE-ENABLED via RapidAPI (free tier, 100 calls/mo)
//    Replaces broken direct scraper with dedicated API module
// 2. Zillow — unchanged, still active
// 3. Redfin — unchanged, still active
//
// The RapidAPI Realtor module also provides enrichment endpoints
// (price history, estimates, schools, scores) used by Pillar 3-5.
// ============================================================
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  CheapHomeItem,
  STATE_NAMES,
  httpQueue,
  getRandomUA,
  parsePrice,
  extractCity,
  extractZip,
  detectPropertyType,
  detectListingType,
  isSourceEnabled,
} from '../home-scraper';

// NEW: Import Realtor.com API scraper
import { scrapeRealtorAPI } from './realtor-api';

// ============================================================
// STATE CAPITAL CITIES — used as search anchors
// ============================================================
const STATE_SEARCH_CITIES: Record<string, string[]> = {
  AL: ['Birmingham', 'Montgomery', 'Mobile'],
  AK: ['Anchorage', 'Fairbanks'],
  AZ: ['Phoenix', 'Tucson', 'Mesa'],
  AR: ['Little Rock', 'Fort Smith'],
  CA: ['Los Angeles', 'Sacramento', 'San Diego', 'Fresno', 'Oakland'],
  CO: ['Denver', 'Colorado Springs', 'Aurora'],
  CT: ['Hartford', 'New Haven', 'Bridgeport'],
  DE: ['Wilmington', 'Dover'],
  FL: ['Jacksonville', 'Miami', 'Tampa', 'Orlando', 'St Petersburg'],
  GA: ['Atlanta', 'Augusta', 'Savannah', 'Columbus'],
  HI: ['Honolulu'],
  ID: ['Boise', 'Meridian'],
  IL: ['Chicago', 'Springfield', 'Rockford', 'Peoria'],
  IN: ['Indianapolis', 'Fort Wayne', 'Evansville'],
  IA: ['Des Moines', 'Cedar Rapids'],
  KS: ['Wichita', 'Kansas City', 'Topeka'],
  KY: ['Louisville', 'Lexington'],
  LA: ['New Orleans', 'Baton Rouge', 'Shreveport'],
  ME: ['Portland', 'Bangor'],
  MD: ['Baltimore', 'Frederick'],
  MA: ['Boston', 'Worcester', 'Springfield'],
  MI: ['Detroit', 'Grand Rapids', 'Flint', 'Lansing'],
  MN: ['Minneapolis', 'St Paul', 'Rochester'],
  MS: ['Jackson', 'Gulfport'],
  MO: ['Kansas City', 'St Louis', 'Springfield'],
  MT: ['Billings', 'Missoula'],
  NE: ['Omaha', 'Lincoln'],
  NV: ['Las Vegas', 'Reno'],
  NH: ['Manchester', 'Nashua'],
  NJ: ['Newark', 'Jersey City', 'Trenton'],
  NM: ['Albuquerque', 'Santa Fe'],
  NY: ['New York', 'Buffalo', 'Rochester', 'Syracuse', 'Albany'],
  NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'],
  ND: ['Fargo', 'Bismarck'],
  OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Dayton', 'Toledo'],
  OK: ['Oklahoma City', 'Tulsa'],
  OR: ['Portland', 'Salem', 'Eugene'],
  PA: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg'],
  RI: ['Providence', 'Warwick'],
  SC: ['Columbia', 'Charleston', 'Greenville'],
  SD: ['Sioux Falls', 'Rapid City'],
  TN: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'],
  TX: ['Houston', 'Dallas', 'San Antonio', 'Austin', 'Fort Worth', 'El Paso'],
  UT: ['Salt Lake City', 'Provo'],
  VT: ['Burlington'],
  VA: ['Virginia Beach', 'Richmond', 'Norfolk'],
  WA: ['Seattle', 'Spokane', 'Tacoma', 'Olympia'],
  WV: ['Charleston', 'Huntington'],
  WI: ['Milwaukee', 'Madison', 'Green Bay'],
  WY: ['Cheyenne', 'Casper'],
};

// ============================================================
// 1. ZILLOW FORECLOSURE CENTER
// (unchanged from v2.3)
// ============================================================
async function scrapeZillow(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('zillow')) return [];
  const items: CheapHomeItem[] = [];
  const cities = STATE_SEARCH_CITIES[state] || [];

  for (const city of cities.slice(0, 2)) {
    try {
      const searchUrl = 'https://www.zillow.com/search/GetSearchPageState.htm';
      const searchQuery = {
        pagination: {},
        usersSearchTerm: `${city}, ${state}`,
        mapBounds: {},
        filterState: {
          isForeclosure: { value: true },
          isPreForeclosureOnce: { value: true },
          isAuction: { value: true },
          sortSelection: { value: 'pricea' },
          price: { max: 200000 },
        },
        isListVisible: true,
      };

      const response = await httpQueue.add(() =>
        axios.get(searchUrl, {
          params: {
            searchQueryState: JSON.stringify(searchQuery),
            wants: JSON.stringify({ cat1: ['listResults'], cat2: ['total'] }),
            requestId: Math.floor(Math.random() * 100),
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': '*/*',
            'Referer': `https://www.zillow.com/${city.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}/`,
          },
          timeout: 20000,
        })
      );

      if (response?.data?.cat1?.searchResults?.listResults) {
        const results = response.data.cat1.searchResults.listResults;

        for (const result of results) {
          const address = result.address || result.streetAddress || '';
          if (!address) continue;

          const priceStr = result.unformattedPrice || result.price || '';
          const price = typeof priceStr === 'number' ? priceStr : parsePrice(String(priceStr));

          items.push({
            title: `Zillow: ${address}`,
            address: result.addressWithZip || `${address}, ${result.addressCity || city}, ${result.addressState || state} ${result.addressZipcode || ''}`,
            city: result.addressCity || city,
            state: result.addressState || state,
            zip: result.addressZipcode || '',
            county: null,
            price,
            original_price: result.zestimate || null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: result.beds || null,
            bathrooms: result.baths || null,
            sqft: result.area || null,
            lot_size: result.lotAreaString || null,
            year_built: null,
            property_type: detectPropertyType(result.propertyType || result.hdpData?.homeInfo?.homeType || ''),
            listing_type: detectListingType(result.statusText || (result.hdpData?.homeInfo?.listing_sub_type?.is_foreclosure ? 'foreclosure' : '')),
            listing_category: 'portal_distressed',
            source: 'zillow',
            source_url: result.detailUrl?.startsWith('http') ? result.detailUrl : `https://www.zillow.com${result.detailUrl || ''}`,
            image_urls: result.imgSrc ? [result.imgSrc] : [],
            description: null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: result.statusText || 'active',
            lat: result.latLong?.latitude || null,
            lng: result.latLong?.longitude || null,
          });
        }
      }
    } catch (err: any) {
      if (err.response?.status !== 403 && err.response?.status !== 429) {
        console.error(`[Homes][Zillow] ${city}, ${state} error: ${err.message}`);
      }
    }
  }

  return items;
}

// ============================================================
// 2. REDFIN — redfin.com
// (unchanged from v2.3)
// ============================================================
async function scrapeRedfin(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('redfin')) return [];
  const items: CheapHomeItem[] = [];
  const cities = STATE_SEARCH_CITIES[state] || [];

  for (const city of cities.slice(0, 2)) {
    try {
      const locationUrl = 'https://www.redfin.com/stingray/do/location-autocomplete';
      const locResponse = await httpQueue.add(() =>
        axios.get(locationUrl, {
          params: { location: `${city}, ${state}`, v: 2 },
          headers: { 'User-Agent': getRandomUA(), 'Accept': '*/*' },
          timeout: 10000,
        })
      );

      let regionId = '';
      let regionType = '';

      if (locResponse?.data) {
        const jsonStr = String(locResponse.data).replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
        try {
          const locData = JSON.parse(jsonStr);
          const exactMatch = locData?.payload?.exactMatch || locData?.payload?.sections?.[0]?.rows?.[0];
          if (exactMatch) {
            regionId = exactMatch.id || '';
            regionType = exactMatch.type || '6';
          }
        } catch {
          const idMatch = String(locResponse.data).match(/"id"\s*:\s*"?(\d+)"?/);
          if (idMatch) regionId = idMatch[1];
        }
      }

      if (!regionId) continue;

      const searchResponse = await httpQueue.add(() =>
        axios.get('https://www.redfin.com/stingray/api/gis', {
          params: {
            al: 1, region_id: regionId, region_type: regionType || 6,
            sold_within_days: 0, status: 9, uipt: '1,2,3',
            sf: '1,2,5,6,7', max_price: 200000, num_homes: 50,
            ord: 'price-asc',
          },
          headers: { 'User-Agent': getRandomUA(), 'Accept': '*/*' },
          timeout: 20000,
        })
      );

      if (searchResponse?.data) {
        const jsonStr = String(searchResponse.data).replace(/^[^{]*/, '');
        try {
          const data = JSON.parse(jsonStr);
          const homes = data?.payload?.homes || [];

          for (const home of homes) {
            const addr = home.streetLine?.value || home.streetLine || '';
            if (!addr) continue;

            items.push({
              title: `Redfin: ${addr}`,
              address: `${addr}, ${home.city || city}, ${home.state || state} ${home.zip || ''}`,
              city: home.city || city,
              state: home.state || state,
              zip: home.zip || '',
              county: home.countyName || null,
              price: home.price?.value || home.price || 0,
              original_price: home.estimatedValue || home.avm || null,
              starting_bid: null,
              assessed_value: null,
              bedrooms: home.beds || null,
              bathrooms: home.baths || null,
              sqft: home.sqFt?.value || home.sqFt || null,
              lot_size: home.lotSize?.value ? `${home.lotSize.value} sqft` : null,
              year_built: home.yearBuilt || null,
              property_type: detectPropertyType(home.propertyType?.toString() || ''),
              listing_type: home.searchStatus === 5 ? 'foreclosure' : detectListingType(home.listingRemarks || ''),
              listing_category: 'portal_distressed',
              source: 'redfin',
              source_url: home.url ? `https://www.redfin.com${home.url}` : 'https://www.redfin.com',
              image_urls: home.photos?.[0]?.photoUrl || home.photo ? [home.photos?.[0]?.photoUrl || home.photo] : [],
              description: home.listingRemarks || null,
              auction_date: null,
              case_number: null,
              parcel_id: null,
              property_status: 'active',
              lat: home.latitude || home.latLong?.latitude || null,
              lng: home.longitude || home.latLong?.longitude || null,
            });
          }
        } catch (e) { /* JSON parse failed */ }
      }
    } catch (err: any) {
      if (err.response?.status !== 403 && err.response?.status !== 429) {
        console.error(`[Homes][Redfin] ${city}, ${state} error: ${err.message}`);
      }
    }
  }

  return items;
}

// ============================================================
// PORTAL SOURCES ORCHESTRATOR — v3.0
//
// CHANGES FROM v2.3:
// - Realtor.com now uses RapidAPI (replaces broken direct scraper)
// - Runs Zillow + Redfin + RealtorAPI in parallel per state
// ============================================================
export async function scrapePortalSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  for (const state of states) {
    if (isTimedOut()) {
      console.log(`[Homes][Portals] Timeout after ${statesProcessed} states`);
      break;
    }

    try {
      const [zillowItems, realtorItems, redfinItems] = await Promise.allSettled([
        scrapeZillow(state),
        scrapeRealtorAPI(state),
        scrapeRedfin(state),
      ]);

      if (zillowItems.status === 'fulfilled') allItems.push(...zillowItems.value);
      if (realtorItems.status === 'fulfilled') allItems.push(...realtorItems.value);
      if (redfinItems.status === 'fulfilled') allItems.push(...redfinItems.value);

      statesProcessed++;
    } catch (err: any) {
      console.error(`[Homes][Portals] ${state} error: ${err.message}`);
    }
  }

  console.log(`[Homes][Portals] ${statesProcessed}/${states.length} states | ${allItems.length} items`);
  return allItems;
}
