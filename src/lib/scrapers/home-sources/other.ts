// ============================================================
//  FILE: src/lib/scrapers/home-sources/other.ts
//  FSBO, CRAIGSLIST HOUSING, & OTHER SOURCES
//  
//  Sources:
//    1. Craigslist Housing — /search/rea (real estate for sale)
//    2. ForSaleByOwner.com — FSBO listings
//    3. Investor/Wholesaler Forums (future expansion)
//
//  Also includes PAID DATA PROVIDER stubs (disabled by default):
//    - Foreclosure.com
//    - Foreclosure Data Hub
//    - PropertyShark
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
  detectListingType,
  isSourceEnabled,
} from '../home-scraper';

// ============================================================
//  CRAIGSLIST CITY SLUGS FOR HOUSING
//  Reuse the same CL infrastructure as yard-sale-scraper
//  but target /search/rea (real estate for sale)
// ============================================================

const CL_HOUSING_SLUGS: Record<string, string[]> = {
  AL: ['birmingham', 'montgomery', 'huntsville', 'mobile'],
  AK: ['anchorage'],
  AZ: ['phoenix', 'tucson', 'flagstaff'],
  AR: ['littlerock', 'fayar'],
  CA: ['losangeles', 'sfbay', 'sandiego', 'sacramento', 'fresno', 'bakersfield', 'inlandempire', 'stockton'],
  CO: ['denver', 'cosprings'],
  CT: ['hartford', 'newhaven'],
  DE: ['delaware'],
  FL: ['miami', 'jacksonville', 'tampa', 'orlando', 'fortlauderdale', 'westpalmbeach', 'pensacola'],
  GA: ['atlanta', 'savannah', 'augusta', 'columbus'],
  HI: ['honolulu'],
  ID: ['boise'],
  IL: ['chicago', 'springfieldil', 'peoria', 'rockford'],
  IN: ['indianapolis', 'fortwayne', 'evansville'],
  IA: ['desmoines', 'cedarrapids'],
  KS: ['kansascity', 'wichita'],
  KY: ['louisville', 'lexington'],
  LA: ['neworleans', 'batonrouge', 'shreveport'],
  ME: ['maine'],
  MD: ['baltimore'],
  MA: ['boston', 'worcester'],
  MI: ['detroit', 'grandrapids', 'flint', 'lansing'],
  MN: ['minneapolis'],
  MS: ['jackson'],
  MO: ['kansascity', 'stlouis', 'springfield'],
  MT: ['billings', 'missoula'],
  NE: ['omaha', 'lincoln'],
  NV: ['lasvegas', 'reno'],
  NH: ['nh'],
  NJ: ['newjersey', 'jerseyshore', 'southjersey'],
  NM: ['albuquerque', 'santafe'],
  NY: ['newyork', 'buffalo', 'rochester', 'syracuse', 'albany', 'longisland', 'hudsonvalley'],
  NC: ['charlotte', 'raleigh', 'greensboro', 'wilmington'],
  ND: ['fargo', 'bismarck'],
  OH: ['cleveland', 'columbus', 'cincinnati', 'dayton', 'toledo', 'akroncanton'],
  OK: ['oklahomacity', 'tulsa'],
  OR: ['portland', 'eugene', 'salem', 'medford'],
  PA: ['philadelphia', 'pittsburgh', 'allentown', 'harrisburg'],
  RI: ['providence'],
  SC: ['charleston', 'columbia', 'greenville'],
  SD: ['siouxfalls'],
  TN: ['nashville', 'memphis', 'knoxville', 'chattanooga'],
  TX: ['houston', 'dallas', 'sanantonio', 'austin', 'fortworth', 'elpaso', 'corpuschristi', 'mcallen'],
  UT: ['saltlakecity', 'provo'],
  VT: ['burlington'],
  VA: ['norfolk', 'richmond', 'roanoke', 'charlottesville'],
  WA: ['seattle', 'spokane', 'tacoma', 'olympia', 'bellingham'],
  WV: ['charleston', 'huntington'],
  WI: ['milwaukee', 'madison', 'greenbay'],
  WY: ['wyoming'],
};

// ============================================================
//  1. CRAIGSLIST HOUSING — /search/rea
//  Scrape cheap housing listings from Craigslist
//  Follows same pattern as your yard sale scraper
// ============================================================

async function scrapeCraigslistHousing(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('craigslist')) return [];
  const items: CheapHomeItem[] = [];
  const slugs = CL_HOUSING_SLUGS[state] || [];

  for (const slug of slugs.slice(0, 3)) { // Limit to 3 cities per state for speed
    try {
      const url = `https://${slug}.craigslist.org/search/rea`;

      const response = await httpQueue.add(() =>
        axios.get(url, {
          params: {
            max_price: 150000,
            min_price: 5000,
            sort: 'priceasc',
            // Foreclosure/distressed keywords
            query: 'foreclosure OR "bank owned" OR "short sale" OR "fixer upper" OR "as is" OR "handyman" OR "investor" OR "cash only" OR "below market"',
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'text/html',
          },
          timeout: 20000,
        })
      );

      if (!response?.data) continue;
      const $ = cheerio.load(response.data);

      // CL search results
      $('li.cl-static-search-result, .result-row, li.cl-search-result').each((_, el) => {
        const titleEl = $(el).find('.title, .titlestring, a.posting-title, .result-title');
        const title = titleEl.text().trim();
        const link = titleEl.find('a').attr('href') || titleEl.attr('href') || $(el).find('a').first().attr('href') || '';
        const priceText = $(el).find('.price, .result-price, .priceinfo').text().trim();
        const location = $(el).find('.location, .result-hood, .meta').text().trim().replace(/[()]/g, '');

        const price = parsePrice(priceText);
        if (price < 5000 || price > 200000) return;
        if (!title || title.length < 5) return;

        // Skip obvious non-property listings
        const lowerTitle = title.toLowerCase();
        if (/\b(room|roommate|sublet|wanted|looking|rent)\b/.test(lowerTitle)) return;

        // Try to extract address from title or location
        const addrMatch = title.match(/(\d+\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Cir|Ter))/i);
        const address = addrMatch ? addrMatch[1] : `${title}, ${location || slug}`;

        // Extract property details from title
        const bedsMatch = title.match(/(\d+)\s*(?:bed|br|bd)/i);
        const bathsMatch = title.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = title.match(/([\d,]+)\s*(?:sq|sf)/i);

        const fullUrl = link.startsWith('http') ? link : `https://${slug}.craigslist.org${link}`;

        items.push({
          title: `CL: ${title.substring(0, 120)}`,
          address: address.length > 10 ? address : `${title}, ${location || STATE_NAMES[state] || state}`,
          city: location || slug,
          state,
          zip: extractZip(title + ' ' + location),
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
          property_type: detectPropertyType(title),
          listing_type: detectListingType(title),
          listing_category: 'other',
          source: 'craigslist',
          source_url: fullUrl,
          image_urls: [],
          description: title,
          auction_date: null,
          case_number: null,
          parcel_id: null,
          property_status: 'active',
          lat: null,
          lng: null,
        });
      });
    } catch (err: any) {
      if (err.response?.status !== 403) {
        console.error(`[Homes][CL] ${slug} error: ${err.message}`);
      }
    }
  }

  return items;
}

// ============================================================
//  2. FORSALEBYOWNER.COM — forsalebyowner.com
//  FSBO listings — typically lower prices, motivated sellers
//  Method: State-level search page
// ============================================================

async function scrapeFSBO(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('fsbo')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const stateName = (STATE_NAMES[state] || state).toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.forsalebyowner.com/search/${stateName}`;

    const response = await httpQueue.add(() =>
      axios.get(url, {
        params: {
          max_price: 150000,
          sort: 'price_asc',
        },
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html',
        },
        timeout: 20000,
      })
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // Check for embedded JSON data first
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const data = JSON.parse($(el).html() || '');
        if (data['@type'] === 'ItemList' && data.itemListElement) {
          for (const item of data.itemListElement) {
            const listing = item.item || item;
            if (listing['@type'] !== 'RealEstateListing' && listing['@type'] !== 'Product') continue;
            
            const addr = listing.address || {};
            const fullAddr = `${addr.streetAddress || ''}, ${addr.addressLocality || ''}, ${addr.addressRegion || state} ${addr.postalCode || ''}`;
            
            items.push({
              title: `FSBO: ${addr.streetAddress || listing.name || ''}`,
              address: fullAddr,
              city: addr.addressLocality || '',
              state: addr.addressRegion || state,
              zip: addr.postalCode || '',
              county: null,
              price: parsePrice(listing.offers?.price || listing.price || '0'),
              original_price: null,
              starting_bid: null,
              assessed_value: null,
              bedrooms: listing.numberOfBedrooms || null,
              bathrooms: listing.numberOfBathroomsTotal || null,
              sqft: listing.floorSize?.value || null,
              lot_size: listing.lotSize?.value ? `${listing.lotSize.value} ${listing.lotSize.unitCode || 'sqft'}` : null,
              year_built: null,
              property_type: detectPropertyType(listing.propertyType || ''),
              listing_type: 'fsbo',
              listing_category: 'other',
              source: 'fsbo',
              source_url: listing.url || `https://www.forsalebyowner.com`,
              image_urls: listing.image ? (Array.isArray(listing.image) ? listing.image : [listing.image]) : [],
              description: listing.description || null,
              auction_date: null,
              case_number: null,
              parcel_id: null,
              property_status: 'active',
              lat: listing.geo?.latitude || null,
              lng: listing.geo?.longitude || null,
            });
          }
        }
      } catch (e) { /* skip */ }
    });

    // HTML card parsing fallback
    if (items.length === 0) {
      $('[class*="listing"], [class*="property"], [class*="card"], [class*="result"]').each((_, el) => {
        const address = $(el).find('[class*="address"]').text().trim();
        const priceText = $(el).find('[class*="price"]').text().trim();
        const link = $(el).find('a').attr('href') || '';
        const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

        const price = parsePrice(priceText);
        if (!address || address.length < 5 || price > 200000) return;

        const text = $(el).text();
        const bedsMatch = text.match(/(\d+)\s*(?:bed|br|bd)/i);
        const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sqft|sq\s*ft|sf)/i);

        items.push({
          title: `FSBO: ${address}`,
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
          listing_type: 'fsbo',
          listing_category: 'other',
          source: 'fsbo',
          source_url: link.startsWith('http') ? link : `https://www.forsalebyowner.com${link}`,
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
    if (err.response?.status !== 403) {
      console.error(`[Homes][FSBO] ${state} error: ${err.message}`);
    }
  }

  return items;
}

// ============================================================
//  PAID DATA PROVIDER STUBS — disabled by default
//  Flip enabled: true in SOURCE_CONFIG when ready to use
// ============================================================

// Foreclosure.com API stub
async function scrapeForeclosureCom(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('foreclosure-com')) return [];
  const apiKey = process.env.FORECLOSURE_COM_KEY;
  if (!apiKey) return [];

  // TODO: Implement when subscription is active
  // API docs: https://www.foreclosure.com/api
  console.log(`[Homes][Foreclosure.com] ${state} — paid source not yet implemented`);
  return [];
}

// Foreclosure Data Hub API stub
async function scrapeForeclosureDataHub(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('foreclosure-datahub')) return [];
  const apiKey = process.env.FORECLOSURE_DATAHUB_KEY;
  if (!apiKey) return [];

  // TODO: Implement when subscription is active
  console.log(`[Homes][ForeclosureDataHub] ${state} — paid source not yet implemented`);
  return [];
}

// PropertyShark API stub
async function scrapePropertyShark(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('propertyshark')) return [];
  const apiKey = process.env.PROPERTYSHARK_KEY;
  if (!apiKey) return [];

  // TODO: Implement when subscription is active
  console.log(`[Homes][PropertyShark] ${state} — paid source not yet implemented`);
  return [];
}

// ============================================================
//  OTHER SOURCES ORCHESTRATOR
// ============================================================

export async function scrapeOtherSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  for (const state of states) {
    if (isTimedOut()) {
      console.log(`[Homes][Other] Timeout after ${statesProcessed} states`);
      break;
    }

    try {
      const [clItems, fsboItems, fcItems, fdhItems, psItems] = await Promise.allSettled([
        scrapeCraigslistHousing(state),
        scrapeFSBO(state),
        scrapeForeclosureCom(state),
        scrapeForeclosureDataHub(state),
        scrapePropertyShark(state),
      ]);

      if (clItems.status === 'fulfilled') allItems.push(...clItems.value);
      if (fsboItems.status === 'fulfilled') allItems.push(...fsboItems.value);
      if (fcItems.status === 'fulfilled') allItems.push(...fcItems.value);
      if (fdhItems.status === 'fulfilled') allItems.push(...fdhItems.value);
      if (psItems.status === 'fulfilled') allItems.push(...psItems.value);

      statesProcessed++;
    } catch (err: any) {
      console.error(`[Homes][Other] ${state} error: ${err.message}`);
    }
  }

  console.log(`[Homes][Other] ${statesProcessed}/${states.length} states | ${allItems.length} items`);
  return allItems;
}
