// ============================================================
// FILE: src/lib/scrapers/home-sources/government.ts
// GOVERNMENT & FEDERAL SOURCES — v3.0 (April 2026)
//
// WHAT CHANGED FROM v2.3:
// 1. HomePath (Fannie Mae) — RE-ENABLED via hidden REST API
//    (bypasses Angular SPA by calling JSON endpoint directly)
//    Imported from new dedicated module: ./homepath.ts
// 2. HUD HomeStore — unchanged, still active
// 3. USDA RD/FSA — unchanged, still active
// 4. HomeSteps — still removed (program discontinued)
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
// 1. HUD HOMESTORE — hudhomestore.gov
// (unchanged from v2.3)
// ============================================================
async function scrapeHUDHomeStore(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('hud-homestore')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const searchUrl = `https://www.hudhomestore.gov/searchresult?citystate=${state}`;
    const response = await httpQueue.add(() =>
      axios.get(searchUrl, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.hudhomestore.gov/',
        },
        timeout: 25000,
      })
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // STRATEGY 1: Parse using data-favorite buttons as card anchors
    const favoriteButtons = $('button[data-favorite]');

    if (favoriteButtons.length > 0) {
      favoriteButtons.each((_, btn) => {
        try {
          const caseNumber = $(btn).attr('data-favorite') || '';
          if (!caseNumber) return;

          let card = $(btn).parent();
          let cardText = card.text();

          for (let depth = 0; depth < 8; depth++) {
            if (cardText.includes('$') && cardText.includes('Beds')) break;
            card = card.parent();
            cardText = card.text();
          }

          if (!cardText.includes('$')) return;

          const priceMatch = cardText.match(/\$([\d,]+(?:\.\d{2})?)/);
          const price = priceMatch ? parsePrice('$' + priceMatch[1]) : 0;

          let streetAddress = '';
          let sourceUrl = '';
          card.find('a').each((_, a) => {
            if (streetAddress) return;
            const linkText = $(a).text().trim();
            const href = $(a).attr('href') || '';
            const ariaLabel = $(a).attr('aria-label') || '';

            if (
              linkText === 'Map View' || linkText === 'Street View' ||
              linkText === 'Email Info' || ariaLabel.includes('photo') ||
              ariaLabel.includes('gallery') || ariaLabel.includes('street view') ||
              href === '#' || href.startsWith('javascript:') || linkText.length < 5
            ) return;

            streetAddress = linkText;
            sourceUrl = href;
          });

          if (!streetAddress || streetAddress.length < 5) return;

          const cityStateZipMatch = cardText.match(
            /([A-Za-z][A-Za-z\s.'\-]+),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)/
          );
          const city = cityStateZipMatch ? cityStateZipMatch[1].trim() : '';
          const zip = cityStateZipMatch ? cityStateZipMatch[3] : '';

          const bedsMatch = cardText.match(/(\d+)\s*Beds?/i);
          const bathsMatch = cardText.match(/([\d.]+)\s*Baths?/i);
          const countyMatch = cardText.match(/([A-Za-z][A-Za-z\s'-]+)\s+County/i);
          const county = countyMatch ? countyMatch[1].trim() : null;

          const bidDateMatch = cardText.match(/BIDS?\s*OPEN\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
          const auctionDate = bidDateMatch ? bidDateMatch[1] : null;

          const fullAddress = city ? `${streetAddress}, ${city}, ${state} ${zip}` : `${streetAddress}, ${state}`;

          if (sourceUrl && !sourceUrl.startsWith('http')) {
            sourceUrl = `https://www.hudhomestore.gov${sourceUrl}`;
          }
          if (!sourceUrl) {
            sourceUrl = `https://www.hudhomestore.gov/searchresult?citystate=${state}#${caseNumber}`;
          }

          items.push({
            title: `HUD Home: ${streetAddress}`,
            address: fullAddress, city, state, zip, county,
            price: price > 0 ? price : 0,
            original_price: null, starting_bid: null, assessed_value: null,
            bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
            bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
            sqft: null, lot_size: null, year_built: null,
            property_type: 'single-family',
            listing_type: 'hud',
            listing_category: 'government',
            source: 'hud-homestore',
            source_url: sourceUrl,
            image_urls: [],
            description: null,
            auction_date: auctionDate,
            case_number: caseNumber || null,
            parcel_id: null,
            property_status: 'active',
            lat: null, lng: null,
          });
        } catch (e) { /* skip malformed */ }
      });
    }

    // STRATEGY 2: Fallback — parse embedded JSON from script tags
    if (items.length === 0) {
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        const jsonMatch = content.match(
          /(?:properties|listings|results|searchResults)\s*[:=]\s*(\[[\s\S]*?\]);/
        );
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            if (Array.isArray(data)) {
              for (const prop of data) {
                const addr = prop.address || prop.streetAddress || '';
                if (!addr) continue;
                items.push({
                  title: `HUD Home: ${addr}`,
                  address: prop.formattedAddress || `${addr}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
                  city: prop.city || '', state,
                  zip: prop.zip || prop.zipCode || '',
                  county: prop.county || null,
                  price: prop.price || prop.listPrice || 0,
                  original_price: null, starting_bid: null, assessed_value: null,
                  bedrooms: prop.bedrooms || prop.beds || null,
                  bathrooms: prop.bathrooms || prop.baths || null,
                  sqft: prop.sqft || prop.squareFeet || null,
                  lot_size: null,
                  year_built: prop.yearBuilt || null,
                  property_type: detectPropertyType(prop.propertyType || ''),
                  listing_type: 'hud',
                  listing_category: 'government',
                  source: 'hud-homestore',
                  source_url: prop.url || prop.detailUrl || `https://www.hudhomestore.gov/searchresult?citystate=${state}`,
                  image_urls: prop.imageUrl ? [prop.imageUrl] : [],
                  description: prop.description || null,
                  auction_date: null,
                  case_number: prop.caseNumber || null,
                  parcel_id: null,
                  property_status: 'active',
                  lat: prop.latitude || null, lng: prop.longitude || null,
                });
              }
            }
          } catch (e) { /* skip */ }
        }
      });
    }

    if (items.length > 0) {
      console.log(`[Homes][HUD] ${state}: ${items.length} properties found`);
    }
  } catch (err: any) {
    console.error(`[Homes][HUD] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
// 2. USDA RD/FSA — properties.sc.egov.usda.gov
// (unchanged from v2.3)
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
// GOVERNMENT SOURCES ORCHESTRATOR — v3.0
//
// CHANGES FROM v2.3:
// - Added HomePath (Fannie Mae) via hidden REST API
// - Now runs HUD + USDA + HomePath in parallel per state
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
