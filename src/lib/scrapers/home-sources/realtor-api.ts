// ============================================================
// FILE: src/lib/scrapers/home-sources/realtor-api.ts
// NEW MODULE: Realtor.com data via RapidAPI
// 
// Uses "US Real Estate Listings" RapidAPI (free tier: 100 calls/mo)
// Host: us-real-estate-listings.p.rapidapi.com
//
// Strategy: Search by major city ZIP codes for foreclosure/distressed
// listings. Conservative API usage — 1 call per city, max 2 cities
// per state to stay within free tier limits.
//
// Requires: RAPIDAPI_KEY env var
// ============================================================
import axios from 'axios';
import {
  CheapHomeItem,
  httpQueue,
  getRandomUA,
  detectPropertyType,
  detectListingType,
  isSourceEnabled,
} from '../home-scraper';

const RAPIDAPI_HOST = 'us-real-estate-listings.p.rapidapi.com';

// Major ZIP codes per state — used as search anchors
// One ZIP per major city, 2-3 per state max
const STATE_ZIPS: Record<string, string[]> = {
  AL: ['35203', '36104'], AK: ['99501'], AZ: ['85001', '85701'],
  AR: ['72201'], CA: ['90001', '95814', '92101'],
  CO: ['80201', '80903'], CT: ['06103', '06510'],
  DE: ['19801'], FL: ['32099', '33101', '34201'],
  GA: ['30301', '31401'], HI: ['96801'],
  ID: ['83701'], IL: ['60601', '62701'],
  IN: ['46201', '46801'], IA: ['50301', '52401'],
  KS: ['67201', '66101'], KY: ['40201', '40501'],
  LA: ['70112', '70801'], ME: ['04101'],
  MD: ['21201'], MA: ['02101', '01601'],
  MI: ['48201', '49501'], MN: ['55401'],
  MS: ['39201'], MO: ['64101', '63101'],
  MT: ['59101'], NE: ['68101', '68501'],
  NV: ['89101', '89501'], NH: ['03101'],
  NJ: ['07101', '08601'], NM: ['87101'],
  NY: ['10001', '14201', '13201'],
  NC: ['28201', '27601'], ND: ['58102'],
  OH: ['43201', '44101', '45201'],
  OK: ['73101', '74101'], OR: ['97201', '97301'],
  PA: ['19101', '15201'], RI: ['02901'],
  SC: ['29201', '29401'], SD: ['57101'],
  TN: ['37201', '38101'], TX: ['77001', '75201', '78201', '73301'],
  UT: ['84101'], VT: ['05401'],
  VA: ['23219', '23451'], WA: ['98101', '99201'],
  WV: ['25301'], WI: ['53201', '53701'], WY: ['82001'],
};

// ============================================================
// REALTOR.COM API — Property List for Sale
// Endpoint: GET /forSale
// Free tier: 100 requests/month
// ============================================================
export async function scrapeRealtorAPI(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('realtor-api')) return [];

  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) {
    console.log('[Homes][RealtorAPI] No RAPIDAPI_KEY set — skipping');
    return [];
  }

  const items: CheapHomeItem[] = [];
  const zips = STATE_ZIPS[state] || [];

  for (const zip of zips.slice(0, 2)) {
    try {
      const response = await httpQueue.add(() =>
        axios.get(`https://${RAPIDAPI_HOST}/forSale`, {
          params: {
            location: zip,
            sort: 'price_low',
            price_max: '200000',
            foreclosure: 'true',
            limit: '50',
          },
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': RAPIDAPI_HOST,
            'Accept': 'application/json',
          },
          timeout: 20000,
        })
      );

      if (!response?.data) continue;

      // Handle various response formats
      const listings = response.data?.data?.results
        || response.data?.results
        || response.data?.properties
        || response.data?.data?.home_search?.results
        || (Array.isArray(response.data) ? response.data : []);

      for (const prop of listings) {
        try {
          const location = prop.location || {};
          const address = location.address || prop.address || {};
          const description = prop.description || {};
          const flags = prop.flags || {};

          const streetAddr = address.line || address.street_address || prop.street || '';
          if (!streetAddr) continue;

          const city = address.city || location.city || '';
          const stateCode = address.state_code || address.state || state;
          const zipCode = address.postal_code || address.zip || zip;
          const county = address.county || '';

          const price = prop.list_price || prop.price || description.price || 0;
          if (price > 250000 || price < 1000) continue;

          const listingType = flags.is_foreclosure ? 'foreclosure'
            : flags.is_short_sale ? 'short-sale'
            : flags.is_bank_owned ? 'reo'
            : flags.is_auction ? 'auction'
            : detectListingType(prop.status || prop.listing_type || '');

          const estimate = prop.estimate?.estimate || prop.price_estimate || null;

          const photos: string[] = [];
          if (prop.primary_photo?.href) photos.push(prop.primary_photo.href);
          if (prop.photos && Array.isArray(prop.photos)) {
            for (const p of prop.photos.slice(0, 5)) {
              if (p.href) photos.push(p.href);
            }
          }

          const sourceUrl = prop.href
            ? `https://www.realtor.com${prop.href}`
            : prop.url || prop.web_url
            || `https://www.realtor.com/realestateandhomes-detail/${prop.property_id || ''}`;

          items.push({
            title: `Realtor: ${streetAddr}`,
            address: `${streetAddr}, ${city}, ${stateCode} ${zipCode}`,
            city,
            state: stateCode,
            zip: zipCode,
            county: county || null,
            price,
            original_price: estimate,
            starting_bid: null,
            assessed_value: null,
            bedrooms: description.beds || prop.beds || null,
            bathrooms: description.baths || prop.baths || null,
            sqft: description.sqft || prop.sqft || null,
            lot_size: description.lot_sqft ? `${description.lot_sqft} sqft` : null,
            year_built: description.year_built || prop.year_built || null,
            property_type: detectPropertyType(
              description.type || prop.property_type || prop.prop_type || ''
            ),
            listing_type: listingType,
            listing_category: 'portal_distressed',
            source: 'realtor-api',
            source_url: sourceUrl,
            image_urls: photos,
            description: description.text || prop.description_text || null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: prop.status || 'for_sale',
            lat: location.address?.coordinate?.lat || prop.latitude || null,
            lng: location.address?.coordinate?.lon || prop.longitude || null,
          });
        } catch (e) {
          // Skip malformed listing
        }
      }

      if (items.length > 0) {
        console.log(`[Homes][RealtorAPI] ${state} (${zip}): ${items.length} properties`);
      }
    } catch (err: any) {
      if (err.response?.status === 429) {
        console.log(`[Homes][RealtorAPI] Rate limited — stopping for this run`);
        break;
      }
      if (err.response?.status === 403) {
        console.log(`[Homes][RealtorAPI] API key unauthorized — check RAPIDAPI_KEY`);
        break;
      }
      console.error(`[Homes][RealtorAPI] ${state}/${zip} error: ${err.message}`);
    }
  }

  return items;
}

// ============================================================
// REALTOR.COM API — Property Details (for enrichment)
// Used by enrichment pipeline to get price history, estimates, etc.
// ============================================================
export async function getPropertyDetails(propertyId: string): Promise<any | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const response = await httpQueue.add(() =>
      axios.get(`https://${RAPIDAPI_HOST}/propertyV2`, {
        params: { id: propertyId },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        timeout: 15000,
      })
    );
    return response?.data?.data || response?.data || null;
  } catch (err: any) {
    console.error(`[RealtorAPI] Detail fetch error: ${err.message}`);
    return null;
  }
}

// ============================================================
// REALTOR.COM API — Price History (for enrichment)
// ============================================================
export async function getPropertyHistory(propertyId: string): Promise<any[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  try {
    const response = await httpQueue.add(() =>
      axios.get(`https://${RAPIDAPI_HOST}/propertyHistory`, {
        params: { id: propertyId },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        timeout: 15000,
      })
    );
    return response?.data?.data || response?.data || [];
  } catch (err: any) {
    console.error(`[RealtorAPI] History fetch error: ${err.message}`);
    return [];
  }
}

// ============================================================
// REALTOR.COM API — Location Scores (for enrichment — Pillar 5)
// Walk score, transit score, bike score
// ============================================================
export async function getLocationScores(propertyId: string): Promise<any | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const response = await httpQueue.add(() =>
      axios.get(`https://${RAPIDAPI_HOST}/locationScores`, {
        params: { id: propertyId },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        timeout: 15000,
      })
    );
    return response?.data?.data || response?.data || null;
  } catch (err: any) {
    console.error(`[RealtorAPI] Scores fetch error: ${err.message}`);
    return null;
  }
}

// ============================================================
// REALTOR.COM API — Schools (for enrichment — Pillar 5)
// ============================================================
export async function getLocationSchools(propertyId: string): Promise<any[]> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return [];

  try {
    const response = await httpQueue.add(() =>
      axios.get(`https://${RAPIDAPI_HOST}/locationSchools`, {
        params: { id: propertyId },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        timeout: 15000,
      })
    );
    return response?.data?.data?.schools || response?.data?.schools || [];
  } catch (err: any) {
    console.error(`[RealtorAPI] Schools fetch error: ${err.message}`);
    return [];
  }
}

// ============================================================
// REALTOR.COM API — Real Estimate / Valuation (for enrichment — Pillar 3)
// ============================================================
export async function getRealEstimate(propertyId: string): Promise<any | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const response = await httpQueue.add(() =>
      axios.get(`https://${RAPIDAPI_HOST}/realEstimate`, {
        params: { id: propertyId },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': RAPIDAPI_HOST,
        },
        timeout: 15000,
      })
    );
    return response?.data?.data || response?.data || null;
  } catch (err: any) {
    console.error(`[RealtorAPI] Estimate fetch error: ${err.message}`);
    return null;
  }
}
