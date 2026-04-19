// ============================================================
// FILE: src/lib/scrapers/home-sources/government.ts
// GOVERNMENT & FEDERAL SOURCES — v4.0 (April 2026)
//
// WHAT CHANGED FROM v3.0:
// 1. HUD HomeStore — REPLACED cheerio HTML scraper with
//    HUD's ArcGIS Open Data REST API (SF_REO FeatureServer).
//    The old approach returned 403 from Vercel/cloud IPs.
//    The ArcGIS API is public, no auth needed, returns JSON
//    with addresses + GPS coords for all HUD REO properties.
// 2. USDA RD/FSA — unchanged, still active & working
// 3. HomePath (Fannie Mae) — unchanged, imported from ./homepath.ts
// ============================================================
import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  CheapHomeItem,
  ALL_STATES,
  STATE_NAMES,
  httpQueue,
  getRandomUA,
  parsePrice,
  extractCity,
  extractZip,
  isValidAddress,
  detectPropertyType,
  isSourceEnabled,
} from '../home-scraper';

// NEW: Import HomePath from dedicated module
import { scrapeHomePath } from './homepath';

// ============================================================
// FIPS STATE CODES — needed for USDA search form
// ============================================================
const FIPS_CODES: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06',
  CO: '08', CT: '09', DE: '10', FL: '12', GA: '13',
  HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
  MA: '25', MI: '26', MN: '27', MS: '28', MO: '29',
  MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34',
  NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45',
  SD: '46', TN: '47', TX: '48', UT: '49', VT: '50',
  VA: '51', WA: '53', WV: '54', WI: '55', WY: '56',
};

const USDA_ACTIVE_STATES = ['GA', 'KY', 'MS', 'NE', 'NY', 'SC', 'TN'];

// ============================================================
// 1. HUD HOMESTORE — via ArcGIS Open Data REST API
//
// v4.0: Replaced HTML scraping with HUD's public ArcGIS
// FeatureServer. No API key needed. Returns JSON with:
//   ADDRESS, CITY, STATE_CODE, DISPLAY_ZIP_CODE,
//   MAP_LATITUDE, MAP_LONGITUDE, CASE_NUM
//
// Note: The API does not return price, beds, baths, or sqft.
// These are HUD-owned foreclosures (REO) — the price is set
// when a buyer submits a bid through hudhomestore.gov.
// We link each listing to its HUD search page for details.
// ============================================================

const HUD_ARCGIS_URL =
  'https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/SF_REO/FeatureServer/0/query';

async function scrapeHUDHomeStore(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('hud-homestore')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const response = await httpQueue.add(() =>
      axios.get(HUD_ARCGIS_URL, {
        params: {
          where: `STATE_CODE='${state}'`,
          outFields: 'CASE_NUM,ADDRESS,CITY,STATE_CODE,DISPLAY_ZIP_CODE,MAP_LATITUDE,MAP_LONGITUDE',
          resultRecordCount: 500,
          f: 'json',
        },
        headers: {
          'User-Agent': getRandomUA(),
          Accept: 'application/json',
        },
        timeout: 25000,
      })
    );

    const features = response?.data?.features;
    if (!Array.isArray(features) || features.length === 0) {
      return items;
    }

    for (const feature of features) {
      try {
        const attrs = feature.attributes;
        if (!attrs) continue;

        const address = (attrs.ADDRESS || '').trim();
        const city = (attrs.CITY || '').trim();
        const stateCode = (attrs.STATE_CODE || state).trim();
        const zip = String(attrs.DISPLAY_ZIP_CODE || '').trim();
        const caseNumber = (attrs.CASE_NUM || '').trim();
        const lat = attrs.MAP_LATITUDE || null;
        const lng = attrs.MAP_LONGITUDE || null;

        // Skip entries with no usable address
        if (!address || address.length < 5) continue;

        const fullAddress = city
          ? `${address}, ${city}, ${stateCode} ${zip}`.trim()
          : `${address}, ${stateCode} ${zip}`.trim();

        // Build source URL pointing to HUD HomeStore search for this state
        // (individual property detail pages require the case number in HUD's system)
        const sourceUrl = caseNumber
          ? `https://www.hudhomestore.gov/Listing/PropertyDetails/${caseNumber}`
          : `https://www.hudhomestore.gov/searchresult?citystate=${stateCode}`;

        items.push({
          title: `HUD Home: ${address}`,
          address: fullAddress,
          city,
          state: stateCode,
          zip,
          county: null,
          price: 0, // HUD REO — price set via bid process, not listed in API
          original_price: null,
          starting_bid: null,
          assessed_value: null,
          bedrooms: null,
          bathrooms: null,
          sqft: null,
          lot_size: null,
          year_built: null,
          property_type: 'single-family',
          listing_type: 'hud',
          listing_category: 'government',
          source: 'hud-homestore',
          source_url: sourceUrl,
          image_urls: [],
          description: 'HUD-owned foreclosure property. Visit HUD HomeStore for pricing and bid details.',
          auction_date: null,
          case_number: caseNumber || null,
          parcel_id: null,
          property_status: 'active',
          lat,
          lng,
        });
      } catch (e) {
        // skip malformed feature
      }
    }

    if (items.length > 0) {
      console.log(`[Homes][HUD] ${state}: ${items.length} properties from ArcGIS API`);
    }
  } catch (err: any) {
    console.error(`[Homes][HUD] ${state} ArcGIS error: ${err.message}`);
  }

  return items;
}

// ============================================================
// 2. USDA RD/FSA — properties.sc.egov.usda.gov
// (unchanged from v3.0 — this source WORKS)
// ============================================================
async function scrapeUSDA(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('usda')) return [];
  const items: CheapHomeItem[] = [];
  const fipsCode = FIPS_CODES[state];
  if (!fipsCode) return items;

  try {
    const searchUrl = 'https://properties.sc.egov.usda.gov/resales/public/searchSFH';

    const response = await httpQueue.add(() =>
      axios.post(
        searchUrl,
        new URLSearchParams({
          stateCode: fipsCode, countyCode: '', city: '', zipCode: '',
          propertyType: 'Single Family', listingType: 'All Types',
          minPrice: '', maxPrice: '', bedrooms: '', bathrooms: '',
          squareFootage: '', Search: 'Search',
        }).toString(),
        {
          headers: {
            'User-Agent': getRandomUA(),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://properties.sc.egov.usda.gov/resales/public/searchSFH',
            'Origin': 'https://properties.sc.egov.usda.gov',
          },
          timeout: 25000,
          maxRedirects: 5,
        }
      )
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    const tableRows = $('table tbody tr, table tr').filter((i, el) => {
      return $(el).find('td').length >= 3;
    });

    if (tableRows.length > 0) {
      tableRows.each((_, el) => {
        try {
          const cells = $(el).find('td');
          const allText = $(el).text();
          if (allText.trim().length < 10) return;

          let address = '', cityText = '', zipText = '', priceText = '';

          cells.each((ci, cell) => {
            const cellText = $(cell).text().trim();
            if (cellText.includes('$') && !priceText) priceText = cellText;
            else if (/^\d+\s+\w/.test(cellText) && !address) address = cellText;
            else if (/^[A-Za-z\s'-]+$/.test(cellText) && cellText.length > 2 && !cityText) cityText = cellText;
            else if (/^\d{5}(-\d{4})?$/.test(cellText) && !zipText) zipText = cellText;
          });

          if (!priceText) {
            const priceMatch = allText.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) priceText = priceMatch[0];
          }

          const link = $(el).find('a').attr('href') || '';
          if (!address) {
            const linkText = $(el).find('a').first().text().trim();
            if (linkText && linkText.length > 5) address = linkText;
          }
          if (!address || address.length < 5) return;

          const price = parsePrice(priceText);
          const bedsMatch = allText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
          const bathsMatch = allText.match(/([\d.]+)\s*(?:bath|ba)/i);
          const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|sf)/i);

          const fullAddress = cityText
            ? `${address}, ${cityText}, ${state} ${zipText}`.trim()
            : `${address}, ${state}`;

          items.push({
            title: `USDA Property: ${address}`,
            address: fullAddress,
            city: cityText || extractCity(fullAddress),
            state,
            zip: zipText || extractZip(fullAddress),
            county: null,
            price: price > 0 ? price : 0,
            original_price: null, starting_bid: null, assessed_value: null,
            bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
            bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
            lot_size: null, year_built: null,
            property_type: 'single-family',
            listing_type: 'usda',
            listing_category: 'government',
            source: 'usda',
            source_url: link.startsWith('http') ? link
              : link ? `https://properties.sc.egov.usda.gov${link}`
              : `https://properties.sc.egov.usda.gov/resales/public/searchSFH?stateCode=${fipsCode}`,
            image_urls: [],
            description: null,
            auction_date: null, case_number: null, parcel_id: null,
            property_status: 'active',
            lat: null, lng: null,
          });
        } catch (e) { /* skip */ }
      });
    }

    // Fallback: try parsing property cards/divs
    if (items.length === 0) {
      $('[class*="property"], [class*="listing"], [class*="result"]').each((_, el) => {
        try {
          const text = $(el).text();
          const address = $(el).find('a').first().text().trim();
          const priceMatch = text.match(/\$([\d,]+)/);
          if (!address || address.length < 5) return;

          items.push({
            title: `USDA Property: ${address}`,
            address: `${address}, ${state}`,
            city: extractCity(address), state,
            zip: extractZip(address),
            county: null,
            price: priceMatch ? parsePrice('$' + priceMatch[1]) : 0,
            original_price: null, starting_bid: null, assessed_value: null,
            bedrooms: null, bathrooms: null, sqft: null,
            lot_size: null, year_built: null,
            property_type: 'single-family',
            listing_type: 'usda',
            listing_category: 'government',
            source: 'usda',
            source_url: `https://properties.sc.egov.usda.gov/resales/public/searchSFH?stateCode=${fipsCode}`,
            image_urls: [],
            description: null,
            auction_date: null, case_number: null, parcel_id: null,
            property_status: 'active',
            lat: null, lng: null,
          });
        } catch (e) { /* skip */ }
      });
    }

    if (items.length > 0) {
      console.log(`[Homes][USDA] ${state}: ${items.length} properties found`);
    }
  } catch (err: any) {
    if (!err.message?.includes('404')) {
      console.error(`[Homes][USDA] ${state} error: ${err.message}`);
    }
  }

  return items;
}

// ============================================================
// GOVERNMENT SOURCES ORCHESTRATOR — v4.0
//
// CHANGES FROM v3.0:
// - HUD now uses ArcGIS API (no more 403s from cloud IPs)
// - Still runs HUD + USDA + HomePath in parallel per state
// ============================================================
export async function scrapeGovernmentSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  const prioritizedStates = [
    ...states.filter((s) => USDA_ACTIVE_STATES.includes(s)),
    ...states.filter((s) => !USDA_ACTIVE_STATES.includes(s)),
  ];

  for (const state of prioritizedStates) {
    if (isTimedOut()) {
      console.log(`[Homes][Gov] Timeout after ${statesProcessed} states`);
      break;
    }

    try {
      // Run HUD + USDA + HomePath in parallel for this state
      const [hudResult, usdaResult, homepathResult] = await Promise.allSettled([
        scrapeHUDHomeStore(state),
        scrapeUSDA(state),
        scrapeHomePath(state),
      ]);

      if (hudResult.status === 'fulfilled') allItems.push(...hudResult.value);
      if (usdaResult.status === 'fulfilled') allItems.push(...usdaResult.value);
      if (homepathResult.status === 'fulfilled') allItems.push(...homepathResult.value);

      statesProcessed++;
    } catch (err: any) {
      console.error(`[Homes][Gov] ${state} error: ${err.message}`);
    }
  }

  console.log(
    `[Homes][Gov] ${statesProcessed}/${states.length} states | ${allItems.length} total items`
  );
  return allItems;
}
