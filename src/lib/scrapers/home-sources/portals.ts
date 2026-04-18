// ============================================================
//  FILE: src/lib/scrapers/home-sources/portals.ts
//  REAL ESTATE PORTAL SOURCES (Distressed/Foreclosure filters)
//  
//  Sources:
//    1. Zillow Foreclosure Center — foreclosure & pre-foreclosure listings
//    2. Realtor.com — distressed/foreclosure filtered search
//    3. Redfin — foreclosure/distressed download endpoint
//
//  NOTE: These portals have aggressive anti-bot measures.
//  Expect some 403/429 responses. The scrapers use multiple
//  strategies (API endpoints, embedded JSON, HTML fallback)
//  and gracefully degrade if blocked.
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

// ============================================================
//  STATE CAPITAL CITIES — used as search anchors for portals
//  that require city-level searches instead of state-level
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
//  1. ZILLOW FORECLOSURE CENTER
//  Method: Internal search API with foreclosure status filter
//  NOTE: Zillow uses PerimeterX bot detection. This scraper
//  attempts their internal API first, then falls back to HTML.
//  May return 0 results if bot-detected — that's expected.
// ============================================================

async function scrapeZillow(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('zillow')) return [];
  const items: CheapHomeItem[] = [];
  const cities = STATE_SEARCH_CITIES[state] || [];

  for (const city of cities.slice(0, 2)) { // Limit to 2 cities per state for speed
    try {
      // Try Zillow's internal search API
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
            listing_type: detectListingType(result.statusText || result.hdpData?.homeInfo?.listing_sub_type?.is_foreclosure ? 'foreclosure' : ''),
            listing_category: 'portal_distressed',
            source: 'zillow',
            source_url: result.detailUrl?.startsWith('http')
              ? result.detailUrl
              : `https://www.zillow.com${result.detailUrl || ''}`,
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
      // Expected — Zillow blocks many requests
      if (err.response?.status !== 403 && err.response?.status !== 429) {
        console.error(`[Homes][Zillow] ${city}, ${state} error: ${err.message}`);
      }
    }
  }

  return items;
}

// ============================================================
//  2. REALTOR.COM — realtor.com
//  Method: Internal API endpoint with foreclosure filter
//  Less aggressive anti-bot than Zillow
// ============================================================

async function scrapeRealtorCom(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('realtor-com')) return [];
  const items: CheapHomeItem[] = [];
  const cities = STATE_SEARCH_CITIES[state] || [];

  for (const city of cities.slice(0, 2)) {
    try {
      const citySlug = city.toLowerCase().replace(/\s+/g, '_');
      const stateSlug = state.toUpperCase();

      // Realtor.com's internal API
      const apiUrl = `https://www.realtor.com/api/v1/hulk`;
      
      const response = await httpQueue.add(() =>
        axios.get(`https://www.realtor.com/realestateforeclosures/${citySlug}_${stateSlug}`, {
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          timeout: 20000,
        })
      );

      if (!response?.data) continue;
      const $ = cheerio.load(response.data);

      // Check for embedded JSON data (Realtor.com embeds search results in scripts)
      $('script[type="application/json"], script[id*="__NEXT_DATA__"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || '');
          
          // Navigate to the property results
          const results = data?.props?.pageProps?.properties 
            || data?.props?.pageProps?.searchResults?.home_search?.results
            || data?.props?.pageProps?.listings
            || [];

          for (const prop of results) {
            const location = prop.location || {};
            const address = location.address || {};
            const fullAddr = address.line || prop.address || '';
            if (!fullAddr) continue;

            const listPrice = prop.list_price || prop.price || 0;
            if (listPrice > 250000) continue; // Only cheap/distressed

            items.push({
              title: `Realtor.com: ${fullAddr}`,
              address: `${fullAddr}, ${address.city || location.city || city}, ${address.state_code || state} ${address.postal_code || ''}`,
              city: address.city || location.city || city,
              state: address.state_code || state,
              zip: address.postal_code || '',
              county: address.county || location.county || null,
              price: listPrice,
              original_price: prop.estimate?.estimate || null,
              starting_bid: null,
              assessed_value: null,
              bedrooms: prop.description?.beds || prop.beds || null,
              bathrooms: prop.description?.baths || prop.baths || null,
              sqft: prop.description?.sqft || prop.sqft || null,
              lot_size: prop.description?.lot_sqft ? `${prop.description.lot_sqft} sqft` : null,
              year_built: prop.description?.year_built || null,
              property_type: detectPropertyType(prop.description?.type || prop.propertyType || ''),
              listing_type: detectListingType(prop.flags?.is_foreclosure ? 'foreclosure' : (prop.status || '')),
              listing_category: 'portal_distressed',
              source: 'realtor-com',
              source_url: prop.href
                ? `https://www.realtor.com${prop.href}`
                : prop.url || `https://www.realtor.com/realestateforeclosures/${citySlug}_${stateSlug}`,
              image_urls: prop.primary_photo?.href ? [prop.primary_photo.href] : [],
              description: prop.description?.text || null,
              auction_date: null,
              case_number: null,
              parcel_id: null,
              property_status: prop.status || 'for_sale',
              lat: location.address?.coordinate?.lat || null,
              lng: location.address?.coordinate?.lon || null,
            });
          }
        } catch (e) {
          // JSON parse failed
        }
      });

      // Fallback: parse HTML cards
      if (items.length === 0) {
        $('[data-testid="property-card"], [class*="PropertyCard"], [class*="card-content"]').each((_, el) => {
          const address = $(el).find('[data-testid="card-address"], [class*="address"]').text().trim();
          const priceText = $(el).find('[data-testid="card-price"], [class*="price"]').text().trim();
          const link = $(el).find('a').attr('href') || '';
          const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

          const price = parsePrice(priceText);
          if (!address || address.length < 5 || price > 250000) return;

          const text = $(el).text();
          const bedsMatch = text.match(/(\d+)\s*(?:bed|br|bd)/i);
          const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
          const sqftMatch = text.match(/([\d,]+)\s*(?:sqft|sq\s*ft|sf)/i);

          items.push({
            title: `Realtor.com: ${address}`,
            address,
            city: extractCity(address),
            state,
            zip: extractZip(address),
            county: null,
            price,
            original_price: null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
            bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
            lot_size: null,
            year_built: null,
            property_type: 'single-family',
            listing_type: 'foreclosure',
            listing_category: 'portal_distressed',
            source: 'realtor-com',
            source_url: link.startsWith('http') ? link : `https://www.realtor.com${link}`,
            image_urls: imgSrc ? [imgSrc] : [],
            description: null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: 'active',
            lat: null,
            lng: null,
          });
        });
      }
    } catch (err: any) {
      if (err.response?.status !== 403 && err.response?.status !== 429) {
        console.error(`[Homes][Realtor.com] ${city}, ${state} error: ${err.message}`);
      }
    }
  }

  return items;
}

// ============================================================
//  3. REDFIN — redfin.com
//  Method: Redfin's data download / stingray API endpoint
//  Less bot protection than Zillow; has CSV download endpoint
// ============================================================

async function scrapeRedfin(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('redfin')) return [];
  const items: CheapHomeItem[] = [];
  const cities = STATE_SEARCH_CITIES[state] || [];

  for (const city of cities.slice(0, 2)) {
    try {
      // Redfin stingray API — location search first
      const locationUrl = 'https://www.redfin.com/stingray/do/location-autocomplete';
      
      const locResponse = await httpQueue.add(() =>
        axios.get(locationUrl, {
          params: {
            location: `${city}, ${state}`,
            v: 2,
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': '*/*',
          },
          timeout: 10000,
        })
      );

      // Redfin returns a callback-wrapped JSON
      let regionId = '';
      let regionType = '';
      if (locResponse?.data) {
        const jsonStr = String(locResponse.data).replace(/^[^{[]*/, '').replace(/[^}\]]*$/, '');
        try {
          const locData = JSON.parse(jsonStr);
          const exactMatch = locData?.payload?.exactMatch || locData?.payload?.sections?.[0]?.rows?.[0];
          if (exactMatch) {
            regionId = exactMatch.id || '';
            regionType = exactMatch.type || '6'; // 6 = city
          }
        } catch {
          // Try regex extraction
          const idMatch = String(locResponse.data).match(/"id"\s*:\s*"?(\d+)"?/);
          if (idMatch) regionId = idMatch[1];
        }
      }

      if (!regionId) continue;

      // Now search for foreclosures in that region
      const searchUrl = 'https://www.redfin.com/stingray/api/gis';

      const searchResponse = await httpQueue.add(() =>
        axios.get(searchUrl, {
          params: {
            al: 1,
            region_id: regionId,
            region_type: regionType || 6,
            sold_within_days: 0,
            status: 9, // 9 = active
            uipt: '1,2,3', // SFR, Condo, Townhouse
            sf: '1,2,5,6,7', // Filters: foreclosure, short sale, bank owned
            max_price: 200000,
            num_homes: 50,
            ord: 'price-asc',
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': '*/*',
          },
          timeout: 20000,
        })
      );

      if (searchResponse?.data) {
        // Redfin wraps response with a prefix
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
              source_url: home.url
                ? `https://www.redfin.com${home.url}`
                : `https://www.redfin.com`,
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
        } catch (e) {
          // JSON parse failed
        }
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
//  PORTAL SOURCES ORCHESTRATOR
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
      // Run portal sources in parallel for each state
      const [zillowItems, realtorItems, redfinItems] = await Promise.allSettled([
        scrapeZillow(state),
        scrapeRealtorCom(state),
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
