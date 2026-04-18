// ============================================================
//  FILE: src/lib/scrapers/home-sources/government.ts
//  GOVERNMENT & FEDERAL SOURCES — FIXED v2.1 (April 2026)
//  
//  WHAT CHANGED FROM v2.0:
//    1. HUD HomeStore — FIXED URL: GET /searchresult?citystate={STATE}
//       (was incorrectly using POST to /Listing/PropertySearchResult which 404s)
//       New selectors based on actual live DOM inspection
//    2. Fannie Mae HomePath — DISABLED (Angular SPA, can't scrape server-side)
//       Returns empty array with log message
//    3. USDA RD/FSA — FIXED URL: /resales/public/searchSFH with FIPS state codes
//       (was incorrectly using /resales/index.jsp which 500s)
//    4. Freddie Mac HomeSteps — REMOVED ENTIRELY
//       Program discontinued, domain dead, all requests return 404
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

// ============================================================
//  FIPS STATE CODES — needed for USDA search form
// ============================================================

const FIPS_CODES: Record<string, string> = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
  DE: '10', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18',
  IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25',
  MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32',
  NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
  OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47',
  TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
  WY: '56',
};

// States known to have USDA listings (as of April 2026)
// We still try all states, but prioritize these
const USDA_ACTIVE_STATES = ['GA', 'KY', 'MS', 'NE', 'NY', 'SC', 'TN'];

// ============================================================
//  1. HUD HOMESTORE — hudhomestore.gov
//  FHA-insured foreclosed properties sold by HUD
//
//  VERIFIED URL: GET https://www.hudhomestore.gov/searchresult?citystate={STATE}
//  
//  HTML structure (verified live April 2026):
//    - Results inside div[role="tabpanel"]
//    - Each property has button[data-favorite="CASE_NUMBER"]
//    - Price as text "$XXX,XXX"
//    - Address in <a> tags (filter out Map View/Street View/Email Info)
//    - Location as text "City, ST, ZIPCODE"
//    - Details as text "X Beds", "X.X Baths"
//    - County as text "CountyName County"
//    - Bid dates as text "BIDS OPEN MM/DD/YYYY"
// ============================================================

async function scrapeHUDHomeStore(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('hud-homestore')) return [];
  const items: CheapHomeItem[] = [];

  try {
    // CORRECT URL — simple GET with state abbreviation
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

    // ---- STRATEGY 1: Parse using data-favorite buttons as card anchors ----
    // Each property card has a button[data-favorite="CASE_NUMBER"]
    const favoriteButtons = $('button[data-favorite]');

    if (favoriteButtons.length > 0) {
      favoriteButtons.each((_, btn) => {
        try {
          const caseNumber = $(btn).attr('data-favorite') || '';
          if (!caseNumber) return;

          // Walk up from the button to find the card container
          // The card container holds price, address, city/state/zip, beds/baths, county
          let card = $(btn).parent();
          let cardText = card.text();

          // Walk up until we find a container with price AND location info
          for (let depth = 0; depth < 8; depth++) {
            if (cardText.includes('$') && cardText.includes('Beds')) break;
            card = card.parent();
            cardText = card.text();
          }

          // If we still don't have good data, skip
          if (!cardText.includes('$')) return;

          // -- Extract PRICE --
          const priceMatch = cardText.match(/\$([\d,]+(?:\.\d{2})?)/);
          const price = priceMatch ? parsePrice('$' + priceMatch[1]) : 0;

          // -- Extract ADDRESS from <a> tags --
          // Filter out non-address links (Map View, Street View, Email Info, photo gallery)
          let streetAddress = '';
          let sourceUrl = '';

          card.find('a').each((_, a) => {
            if (streetAddress) return; // already found
            const linkText = $(a).text().trim();
            const href = $(a).attr('href') || '';
            const ariaLabel = $(a).attr('aria-label') || '';

            // Skip non-address links
            if (
              linkText === 'Map View' ||
              linkText === 'Street View' ||
              linkText === 'Email Info' ||
              ariaLabel.includes('photo') ||
              ariaLabel.includes('gallery') ||
              ariaLabel.includes('street view') ||
              href === '#' ||
              href.startsWith('javascript:') ||
              linkText.length < 5
            ) return;

            // This is likely the address link
            streetAddress = linkText;
            sourceUrl = href;
          });

          if (!streetAddress || streetAddress.length < 5) return;

          // -- Extract CITY, STATE, ZIP --
          // Pattern: "City Name, ST, ZIPCODE" or "City Name, ST ZIPCODE"
          const cityStateZipMatch = cardText.match(
            /([A-Za-z][A-Za-z\s.''-]+),\s*([A-Z]{2}),?\s*(\d{5}(?:-\d{4})?)/
          );
          const city = cityStateZipMatch ? cityStateZipMatch[1].trim() : '';
          const zip = cityStateZipMatch ? cityStateZipMatch[3] : '';

          // -- Extract BEDS / BATHS --
          const bedsMatch = cardText.match(/(\d+)\s*Beds?/i);
          const bathsMatch = cardText.match(/([\d.]+)\s*Baths?/i);

          // -- Extract COUNTY --
          const countyMatch = cardText.match(/([A-Za-z][A-Za-z\s'-]+)\s+County/i);
          const county = countyMatch ? countyMatch[1].trim() : null;

          // -- Extract BID/AUCTION DATE --
          const bidDateMatch = cardText.match(
            /BIDS?\s*OPEN\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
          );
          const auctionDate = bidDateMatch ? bidDateMatch[1] : null;

          // -- Build full address --
          const fullAddress = city
            ? `${streetAddress}, ${city}, ${state} ${zip}`
            : `${streetAddress}, ${state}`;

          // -- Build source URL --
          if (sourceUrl && !sourceUrl.startsWith('http')) {
            sourceUrl = `https://www.hudhomestore.gov${sourceUrl}`;
          }
          if (!sourceUrl) {
            sourceUrl = `https://www.hudhomestore.gov/searchresult?citystate=${state}#${caseNumber}`;
          }

          items.push({
            title: `HUD Home: ${streetAddress}`,
            address: fullAddress,
            city,
            state,
            zip,
            county,
            price: price > 0 ? price : 0,
            original_price: null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
            bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
            sqft: null, // HUD list view doesn't show sqft
            lot_size: null,
            year_built: null,
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
            lat: null,
            lng: null,
          });
        } catch (e) {
          // Skip malformed cards
        }
      });
    }

    // ---- STRATEGY 2: Fallback — parse embedded JSON from script tags ----
    if (items.length === 0) {
      $('script').each((_, el) => {
        const content = $(el).html() || '';
        // Look for JSON arrays with property data
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
                  city: prop.city || '',
                  state,
                  zip: prop.zip || prop.zipCode || '',
                  county: prop.county || null,
                  price: prop.price || prop.listPrice || 0,
                  original_price: null,
                  starting_bid: null,
                  assessed_value: null,
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
                  lat: prop.latitude || null,
                  lng: prop.longitude || null,
                });
              }
            }
          } catch (e) {
            // JSON parse failed
          }
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
//  2. FANNIE MAE HOMEPATH — homepath.fanniemae.com
//  
//  STATUS: DISABLED — Angular SPA requires headless browser
//  
//  The real URL is: https://homepath.fanniemae.com/property-finder?bounds={lat1},{lng1},{lat2},{lng2}
//  But it's an Angular app that loads data via internal API calls.
//  Server-side axios/cheerio cannot render Angular — returns empty shell.
//  
//  TODO: Find the hidden REST API behind the Angular frontend,
//  or use a headless browser (Puppeteer/Playwright) to scrape.
//  HomePath has 100K+ listings — massive potential when enabled.
// ============================================================

async function scrapeHomePath(_state: string): Promise<CheapHomeItem[]> {
  // DISABLED — Angular SPA cannot be scraped server-side
  // HomePath uses: https://homepath.fanniemae.com/property-finder?bounds=...
  // which is an Angular app that dynamically loads property data
  console.log(`[Homes][HomePath] DISABLED — Angular SPA requires headless browser`);
  return [];
}

// ============================================================
//  3. USDA RD/FSA — properties.sc.egov.usda.gov
//  Government-owned rural development & farm service properties
//
//  VERIFIED URL: https://properties.sc.egov.usda.gov/resales/public/searchSFH
//  (was incorrectly using /resales/index.jsp which returns 500)
//
//  Method: POST form with FIPS stateCode, parse HTML results table
//  
//  NOTE: Small inventory (18 properties across 7 states as of April 2026)
//  but these are legitimate government-owned properties at good prices.
//  Active states: GA, KY, MS, NE, NY, SC, TN (changes over time)
// ============================================================

async function scrapeUSDA(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('usda')) return [];
  const items: CheapHomeItem[] = [];

  const fipsCode = FIPS_CODES[state];
  if (!fipsCode) return items;

  try {
    const searchUrl = 'https://properties.sc.egov.usda.gov/resales/public/searchSFH';

    // POST the search form with FIPS state code
    const response = await httpQueue.add(() =>
      axios.post(
        searchUrl,
        new URLSearchParams({
          stateCode: fipsCode,
          countyCode: '',
          city: '',
          zipCode: '',
          propertyType: 'Single Family',
          listingType: 'All Types',
          minPrice: '',
          maxPrice: '',
          bedrooms: '',
          bathrooms: '',
          squareFootage: '',
          Search: 'Search',
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
          // Follow redirects in case the form submission redirects to results
          maxRedirects: 5,
        }
      )
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // USDA results are typically in a table format
    // Try multiple selector strategies
    const tableRows = $('table tbody tr, table tr').filter((i, el) => {
      // Skip header rows
      const cells = $(el).find('td');
      return cells.length >= 3;
    });

    if (tableRows.length > 0) {
      tableRows.each((_, el) => {
        try {
          const cells = $(el).find('td');
          const allText = $(el).text();

          // Skip rows without meaningful data
          if (allText.trim().length < 10) return;

          // Extract data from cells — exact column order depends on USDA's layout
          let address = '';
          let cityText = '';
          let zipText = '';
          let priceText = '';

          // Try to find address, city, price from cells
          cells.each((ci, cell) => {
            const cellText = $(cell).text().trim();
            // Cell with dollar sign is price
            if (cellText.includes('$') && !priceText) {
              priceText = cellText;
            }
            // Cell that looks like an address (has numbers and letters)
            else if (/^\d+\s+\w/.test(cellText) && !address) {
              address = cellText;
            }
            // Cell that looks like a city name (just letters/spaces)
            else if (/^[A-Za-z\s'-]+$/.test(cellText) && cellText.length > 2 && !cityText) {
              cityText = cellText;
            }
            // Cell that looks like a zip
            else if (/^\d{5}(-\d{4})?$/.test(cellText) && !zipText) {
              zipText = cellText;
            }
          });

          // Also try extracting from the whole row text
          if (!priceText) {
            const priceMatch = allText.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) priceText = priceMatch[0];
          }

          // Extract link
          const link = $(el).find('a').attr('href') || '';

          // If we found an address via link text
          if (!address) {
            const linkText = $(el).find('a').first().text().trim();
            if (linkText && linkText.length > 5) address = linkText;
          }

          if (!address || address.length < 5) return;

          const price = parsePrice(priceText);

          // Try beds/baths/sqft from text
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
            original_price: null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
            bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
            lot_size: null,
            year_built: null,
            property_type: 'single-family',
            listing_type: 'usda',
            listing_category: 'government',
            source: 'usda',
            source_url: link.startsWith('http')
              ? link
              : link
                ? `https://properties.sc.egov.usda.gov${link}`
                : `https://properties.sc.egov.usda.gov/resales/public/searchSFH?stateCode=${fipsCode}`,
            image_urls: [],
            description: null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: 'active',
            lat: null,
            lng: null,
          });
        } catch (e) {
          // Skip malformed rows
        }
      });
    }

    // Fallback: try parsing property cards/divs if no table
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
            city: extractCity(address),
            state,
            zip: extractZip(address),
            county: null,
            price: priceMatch ? parsePrice('$' + priceMatch[1]) : 0,
            original_price: null,
            starting_bid: null,
            assessed_value: null,
            bedrooms: null,
            bathrooms: null,
            sqft: null,
            lot_size: null,
            year_built: null,
            property_type: 'single-family',
            listing_type: 'usda',
            listing_category: 'government',
            source: 'usda',
            source_url: `https://properties.sc.egov.usda.gov/resales/public/searchSFH?stateCode=${fipsCode}`,
            image_urls: [],
            description: null,
            auction_date: null,
            case_number: null,
            parcel_id: null,
            property_status: 'active',
            lat: null,
            lng: null,
          });
        } catch (e) {
          // Skip
        }
      });
    }

    if (items.length > 0) {
      console.log(`[Homes][USDA] ${state}: ${items.length} properties found`);
    }
  } catch (err: any) {
    // Only log if it's not a "no results" type error
    if (!err.message?.includes('404')) {
      console.error(`[Homes][USDA] ${state} error: ${err.message}`);
    }
  }

  return items;
}

// ============================================================
//  HOMESTEPS — REMOVED
//  
//  Freddie Mac discontinued the HomeSteps program.
//  homesteps.freddiemac.com and homesteps.com are both dead (404).
//  All requests were failing with 404 for every state.
//  
//  Freddie Mac REO properties may now be listed through their
//  servicers directly. If a new Freddie Mac portal emerges,
//  add it here.
// ============================================================

// (No scrapeHomeSteps function — intentionally removed)

// ============================================================
//  GOVERNMENT SOURCES ORCHESTRATOR
//
//  CHANGES FROM v2.0:
//    - Removed HomeSteps (dead program)
//    - Only runs HUD + USDA (HomePath disabled)
//    - USDA prioritizes known-active states first
//    - Better logging per source per state
// ============================================================

export async function scrapeGovernmentSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  // Reorder states: put USDA-active states first so they get processed
  // before any potential timeout
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
      // Run HUD + USDA in parallel for this state
      // (HomePath disabled, HomeSteps removed)
      const [hudResult, usdaResult] = await Promise.allSettled([
        scrapeHUDHomeStore(state),
        scrapeUSDA(state),
      ]);

      if (hudResult.status === 'fulfilled') allItems.push(...hudResult.value);
      if (usdaResult.status === 'fulfilled') allItems.push(...usdaResult.value);

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
