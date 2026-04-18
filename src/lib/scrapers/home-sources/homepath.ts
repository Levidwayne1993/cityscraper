// ============================================================
// FILE: src/lib/scrapers/home-sources/homepath.ts
// NEW MODULE: Fannie Mae HomePath REO Properties
//
// HomePath.FannieMae.com is an Angular SPA, but the property
// data is loaded from a hidden REST API at:
//   https://homepath.fanniemae.com/api/v1/property/search
//
// This module calls that API directly, bypassing Angular.
// Returns Fannie Mae-owned REO properties (foreclosed).
//
// No API key required — public JSON endpoint.
// ============================================================
import axios from 'axios';
import {
  CheapHomeItem,
  STATE_NAMES,
  httpQueue,
  getRandomUA,
  detectPropertyType,
  isSourceEnabled,
} from '../home-scraper';

// State bounding boxes for geographic search
// HomePath uses lat/lng bounds, not state codes
const STATE_BOUNDS: Record<string, { north: number; south: number; east: number; west: number }> = {
  AL: { north: 35.0, south: 30.2, east: -84.9, west: -88.5 },
  AK: { north: 71.4, south: 51.2, east: -130.0, west: -179.1 },
  AZ: { north: 37.0, south: 31.3, east: -109.0, west: -114.8 },
  AR: { north: 36.5, south: 33.0, east: -89.6, west: -94.6 },
  CA: { north: 42.0, south: 32.5, east: -114.1, west: -124.4 },
  CO: { north: 41.0, south: 36.9, east: -102.0, west: -109.1 },
  CT: { north: 42.1, south: 40.9, east: -71.8, west: -73.7 },
  DE: { north: 39.8, south: 38.5, east: -75.0, west: -75.8 },
  FL: { north: 31.0, south: 24.4, east: -79.9, west: -87.6 },
  GA: { north: 35.0, south: 30.4, east: -80.8, west: -85.6 },
  HI: { north: 22.2, south: 18.9, east: -154.8, west: -160.2 },
  ID: { north: 49.0, south: 42.0, east: -111.0, west: -117.2 },
  IL: { north: 42.5, south: 36.9, east: -87.5, west: -91.5 },
  IN: { north: 41.8, south: 37.8, east: -84.8, west: -88.1 },
  IA: { north: 43.5, south: 40.4, east: -90.1, west: -96.6 },
  KS: { north: 40.0, south: 37.0, east: -94.6, west: -102.1 },
  KY: { north: 39.2, south: 36.5, east: -82.0, west: -89.6 },
  LA: { north: 33.0, south: 28.9, east: -89.0, west: -94.0 },
  ME: { north: 47.5, south: 43.1, east: -66.9, west: -71.1 },
  MD: { north: 39.7, south: 37.9, east: -75.0, west: -79.5 },
  MA: { north: 42.9, south: 41.2, east: -69.9, west: -73.5 },
  MI: { north: 48.3, south: 41.7, east: -82.1, west: -90.4 },
  MN: { north: 49.4, south: 43.5, east: -89.5, west: -97.2 },
  MS: { north: 35.0, south: 30.2, east: -88.1, west: -91.7 },
  MO: { north: 40.6, south: 36.0, east: -89.1, west: -95.8 },
  MT: { north: 49.0, south: 44.4, east: -104.0, west: -116.1 },
  NE: { north: 43.0, south: 40.0, east: -95.3, west: -104.1 },
  NV: { north: 42.0, south: 35.0, east: -114.0, west: -120.0 },
  NH: { north: 45.3, south: 42.7, east: -70.7, west: -72.6 },
  NJ: { north: 41.4, south: 38.9, east: -73.9, west: -75.6 },
  NM: { north: 37.0, south: 31.3, east: -103.0, west: -109.1 },
  NY: { north: 45.0, south: 40.5, east: -71.9, west: -79.8 },
  NC: { north: 36.6, south: 33.8, east: -75.5, west: -84.3 },
  ND: { north: 49.0, south: 45.9, east: -96.6, west: -104.1 },
  OH: { north: 42.0, south: 38.4, east: -80.5, west: -84.8 },
  OK: { north: 37.0, south: 33.6, east: -94.4, west: -103.0 },
  OR: { north: 46.3, south: 42.0, east: -116.5, west: -124.6 },
  PA: { north: 42.3, south: 39.7, east: -74.7, west: -80.5 },
  RI: { north: 42.0, south: 41.1, east: -71.1, west: -71.9 },
  SC: { north: 35.2, south: 32.0, east: -78.5, west: -83.4 },
  SD: { north: 46.0, south: 42.5, east: -96.4, west: -104.1 },
  TN: { north: 36.7, south: 35.0, east: -81.6, west: -90.3 },
  TX: { north: 36.5, south: 25.8, east: -93.5, west: -106.6 },
  UT: { north: 42.0, south: 37.0, east: -109.0, west: -114.1 },
  VT: { north: 45.0, south: 42.7, east: -71.5, west: -73.4 },
  VA: { north: 39.5, south: 36.5, east: -75.2, west: -83.7 },
  WA: { north: 49.0, south: 45.5, east: -116.9, west: -124.8 },
  WV: { north: 40.6, south: 37.2, east: -77.7, west: -82.6 },
  WI: { north: 47.1, south: 42.5, east: -86.8, west: -92.9 },
  WY: { north: 45.0, south: 41.0, east: -104.1, west: -111.1 },
};

export async function scrapeHomePath(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('homepath')) return [];

  const items: CheapHomeItem[] = [];
  const bounds = STATE_BOUNDS[state];
  if (!bounds) return items;

  try {
    // Strategy 1: Try the hidden REST API
    const apiUrl = 'https://homepath.fanniemae.com/api/v1/property/search';

    const response = await httpQueue.add(() =>
      axios.post(apiUrl, {
        bounds: {
          northEast: { lat: bounds.north, lng: bounds.east },
          southWest: { lat: bounds.south, lng: bounds.west },
        },
        filters: {
          maxPrice: 200000,
          propertyTypes: ['SingleFamily', 'Condo', 'Townhome', 'MultiFamily'],
        },
        pagination: { page: 1, pageSize: 50 },
        sort: { field: 'price', direction: 'asc' },
      }, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Origin': 'https://homepath.fanniemae.com',
          'Referer': 'https://homepath.fanniemae.com/property-finder',
        },
        timeout: 25000,
      })
    );

    if (!response?.data) return items;

    const properties = response.data?.properties
      || response.data?.results
      || response.data?.data?.properties
      || (Array.isArray(response.data) ? response.data : []);

    for (const prop of properties) {
      try {
        const addr = prop.address || prop.propertyAddress || {};
        const street = typeof addr === 'string' ? addr : (addr.street || addr.line1 || addr.streetAddress || '');
        if (!street) continue;

        const city = addr.city || prop.city || '';
        const zip = addr.zip || addr.postalCode || prop.zip || '';

        const fullAddress = `${street}, ${city}, ${state} ${zip}`;
        const price = prop.listPrice || prop.price || prop.currentPrice || 0;

        items.push({
          title: `HomePath: ${street}`,
          address: fullAddress,
          city,
          state,
          zip,
          county: prop.county || addr.county || null,
          price,
          original_price: prop.originalPrice || prop.previousPrice || null,
          starting_bid: null,
          assessed_value: prop.assessedValue || null,
          bedrooms: prop.bedrooms || prop.beds || null,
          bathrooms: prop.bathrooms || prop.baths || null,
          sqft: prop.squareFeet || prop.sqft || prop.livingArea || null,
          lot_size: prop.lotSize || prop.lotSquareFeet ? `${prop.lotSquareFeet || prop.lotSize} sqft` : null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: 'reo',
          listing_category: 'government',
          source: 'homepath',
          source_url: prop.url || prop.detailUrl || prop.permalink
            || `https://homepath.fanniemae.com/property/${prop.id || prop.listingId || ''}`,
          image_urls: prop.photos || prop.images || (prop.primaryPhoto ? [prop.primaryPhoto] : []),
          description: prop.description || prop.remarks || null,
          auction_date: null,
          case_number: prop.caseNumber || prop.loanNumber || null,
          parcel_id: prop.parcelId || prop.apn || null,
          property_status: prop.status || 'active',
          lat: prop.latitude || prop.lat || addr.latitude || null,
          lng: prop.longitude || prop.lng || addr.longitude || null,
        });
      } catch (e) {
        // Skip malformed
      }
    }

    if (items.length > 0) {
      console.log(`[Homes][HomePath] ${state}: ${items.length} Fannie Mae REO properties`);
    }
  } catch (err: any) {
    // Strategy 2: Try alternate URL patterns
    try {
      const altUrl = `https://homepath.fanniemae.com/property-finder/api/properties`;
      const altResponse = await httpQueue.add(() =>
        axios.get(altUrl, {
          params: {
            state,
            maxPrice: 200000,
            page: 1,
            size: 50,
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'application/json',
            'Referer': 'https://homepath.fanniemae.com/property-finder',
          },
          timeout: 20000,
        })
      );

      const props = altResponse?.data?.content || altResponse?.data?.properties || altResponse?.data || [];
      if (Array.isArray(props)) {
        for (const prop of props) {
          const street = prop.addressLine1 || prop.address || '';
          if (!street) continue;

          items.push({
            title: `HomePath: ${street}`,
            address: `${street}, ${prop.city || ''}, ${state} ${prop.zipCode || ''}`,
            city: prop.city || '',
            state,
            zip: prop.zipCode || '',
            county: prop.county || null,
            price: prop.listPrice || prop.price || 0,
            original_price: null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: prop.bedrooms || null,
            bathrooms: prop.bathrooms || null,
            sqft: prop.squareFeet || null,
            lot_size: null,
            year_built: prop.yearBuilt || null,
            property_type: detectPropertyType(prop.propertyType || ''),
            listing_type: 'reo',
            listing_category: 'government',
            source: 'homepath',
            source_url: `https://homepath.fanniemae.com/property/${prop.id || ''}`,
            image_urls: prop.photos || [],
            description: prop.description || null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: 'active',
            lat: prop.latitude || null,
            lng: prop.longitude || null,
          });
        }
      }

      if (items.length > 0) {
        console.log(`[Homes][HomePath] ${state}: ${items.length} properties (alt endpoint)`);
      }
    } catch (altErr: any) {
      // Both strategies failed
      if (!altErr.message?.includes('403') && !altErr.message?.includes('404')) {
        console.error(`[Homes][HomePath] ${state} error: ${err.message} / alt: ${altErr.message}`);
      }
    }
  }

  return items;
}
