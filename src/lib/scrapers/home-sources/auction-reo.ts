// ============================================================
//  FILE: src/lib/scrapers/home-sources/auction-reo.ts
//  AUCTION PLATFORMS & BANK-OWNED REO SOURCES — v4.0 (April 2026)
//
//  WHAT CHANGED FROM v3.0:
//  1. Auction.com — DISABLED. Site is a fully client-rendered
//     React SPA (data-app-id=resi-search). No __NEXT_DATA__,
//     no server-rendered HTML, no public API found. Tested:
//       - /api/v1/search → 404
//       - /aon-ui-v2/api/search/assets → 404
//     Returns empty array with log message instead of erroring.
//  2. Xome — DISABLED. Site is completely down, returns
//     "Custom Error Page" / "We are having trouble loading
//     this page" on all routes. Returns empty array with log.
//  3. Hubzu — unchanged, still active
//  4. RealtyMole API — unchanged (requires API key)
//  5. RentCast API — unchanged (requires API key)
//
//  Sources:
//    1. Auction.com — DISABLED (client-rendered SPA, no API)
//    2. Hubzu — online REO auction marketplace
//    3. Xome Auctions — DISABLED (site down)
//    4. RealtyMole API (if key set)
//    5. RentCast API (if key set)
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
//  1. AUCTION.COM — DISABLED
//
//  v4.0: Disabled. Auction.com is a fully client-rendered
//  React SPA. Server-side requests get an empty HTML shell
//  with no property data. No public REST/GraphQL API exists.
//  Re-enable if Auction.com adds server rendering or a
//  public API in the future.
// ============================================================

async function scrapeAuctionCom(state: string): Promise<CheapHomeItem[]> {
  // DISABLED — Auction.com is a client-rendered React SPA.
  // No server-side HTML data, no public API.
  // Uncomment isSourceEnabled check if re-enabling in the future.
  console.log(`[Homes][Auction.com] ${state}: DISABLED — client-rendered SPA, no public API`);
  return [];
}

// ============================================================
//  2. HUBZU — hubzu.com
//  Online REO auction marketplace
//  Method: Scrape state search results
//  (unchanged from v3.0)
// ============================================================

async function scrapeHubzu(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('hubzu')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const stateName = (STATE_NAMES[state] || state).toLowerCase().replace(/\s+/g, '-');
    
    // Try API endpoint first
    const apiUrl = `https://www.hubzu.com/api/search`;
    let response;

    try {
      response = await httpQueue.add(() =>
        axios.get(apiUrl, {
          params: {
            state: state,
            propertyType: 'residential',
            page: 1,
            pageSize: 50,
            sort: 'price_asc',
          },
          headers: {
            'User-Agent': getRandomUA(),
            'Accept': 'application/json',
          },
          timeout: 20000,
        })
      );
    } catch {
      // Fall back to HTML page
      response = await httpQueue.add(() =>
        axios.get(`https://www.hubzu.com/properties/${stateName}`, {
          headers: { 'User-Agent': getRandomUA() },
          timeout: 20000,
        })
      );
    }

    if (!response?.data) return items;

    if (typeof response.data === 'object') {
      // JSON API response
      const listings = response.data.properties || response.data.results || response.data.listings || [];
      for (const prop of listings) {
        const addr = prop.address || prop.propertyAddress || '';
        const fullAddr = typeof addr === 'object'
          ? `${addr.street || ''}, ${addr.city || ''}, ${addr.state || state} ${addr.zip || ''}`
          : addr;

        if (!fullAddr || fullAddr.length < 5) continue;

        items.push({
          title: `Hubzu: ${fullAddr}`,
          address: fullAddr,
          city: typeof addr === 'object' ? (addr.city || '') : extractCity(fullAddr),
          state,
          zip: typeof addr === 'object' ? (addr.zip || '') : extractZip(fullAddr),
          county: prop.county || null,
          price: prop.currentBid || prop.listPrice || prop.price || 0,
          original_price: prop.marketValue || prop.estimatedValue || null,
          starting_bid: prop.startingBid || prop.reservePrice || null,
          assessed_value: null,
          bedrooms: prop.bedrooms || prop.beds || null,
          bathrooms: prop.bathrooms || prop.baths || null,
          sqft: prop.sqft || prop.squareFeet || null,
          lot_size: prop.lotSize || null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: 'auction',
          listing_category: 'auction',
          source: 'hubzu',
          source_url: prop.url || prop.detailUrl || `https://www.hubzu.com/property/${prop.id || ''}`,
          image_urls: prop.photos || prop.images || [],
          description: prop.description || null,
          auction_date: prop.auctionEndDate || prop.auctionDate || null,
          case_number: null,
          parcel_id: prop.parcelId || null,
          property_status: prop.status || 'active',
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    } else {
      // HTML parsing
      const $ = cheerio.load(response.data);

      $('[class*="property"], [class*="listing"], [class*="card"]').each((_, el) => {
        const address = $(el).find('[class*="address"]').text().trim();
        const priceText = $(el).find('[class*="price"], [class*="bid"]').text().trim();
        const link = $(el).find('a').attr('href') || '';
        const imgSrc = $(el).find('img').attr('src') || '';

        const price = parsePrice(priceText);
        if (!address || address.length < 5) return;

        const text = $(el).text();
        const bedsMatch = text.match(/(\d+)\s*(?:bed|br|bd)/i);
        const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sq|sf)/i);

        items.push({
          title: `Hubzu: ${address}`,
          address,
          city: extractCity(address),
          state,
          zip: extractZip(address),
          county: null,
          price,
          original_price: null,
          starting_bid: price,
          assessed_value: null,
          bedrooms: bedsMatch ? parseInt(bedsMatch[1]) : null,
          bathrooms: bathsMatch ? parseFloat(bathsMatch[1]) : null,
          sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
          lot_size: null,
          year_built: null,
          property_type: 'single-family',
          listing_type: 'auction',
          listing_category: 'auction',
          source: 'hubzu',
          source_url: link.startsWith('http') ? link : `https://www.hubzu.com${link}`,
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
    console.error(`[Homes][Hubzu] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  3. XOME — DISABLED
//
//  v4.0: Disabled. Xome.com is completely down — all routes
//  return "Custom Error Page" / "We are having trouble loading
//  this page". Re-enable if the site comes back online.
// ============================================================

async function scrapeXome(state: string): Promise<CheapHomeItem[]> {
  // DISABLED — Xome.com is completely down (all routes return error page).
  // Uncomment isSourceEnabled check if re-enabling in the future.
  console.log(`[Homes][Xome] ${state}: DISABLED — site is down`);
  return [];
}

// ============================================================
//  4. REALTYMOLE API — rapidapi.com (requires API key)
//  Real estate data API with foreclosure/distressed filters
//  (unchanged from v3.0)
// ============================================================

async function scrapeRealtyMole(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('realtymole')) return [];
  const items: CheapHomeItem[] = [];
  const apiKey = process.env.REALTY_MOLE_API_KEY;
  if (!apiKey) return items;

  try {
    const response = await httpQueue.add(() =>
      axios.get('https://realty-mole-property-api.p.rapidapi.com/saleListings', {
        params: {
          state,
          limit: 50,
          status: 'Active',
          sort: 'price',
        },
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'realty-mole-property-api.p.rapidapi.com',
        },
        timeout: 15000,
      })
    );

    if (Array.isArray(response?.data)) {
      for (const prop of response.data) {
        if (!prop.price || prop.price > 200000) continue; // Only cheap homes

        items.push({
          title: `${prop.propertyType || 'Property'}: ${prop.addressLine1 || prop.formattedAddress}`,
          address: prop.formattedAddress || prop.addressLine1 || '',
          city: prop.city || '',
          state: prop.state || state,
          zip: prop.zipCode || '',
          county: prop.county || null,
          price: prop.price,
          original_price: null,
          starting_bid: null,
          assessed_value: null,
          bedrooms: prop.bedrooms || null,
          bathrooms: prop.bathrooms || null,
          sqft: prop.squareFootage || null,
          lot_size: prop.lotSize ? `${prop.lotSize} sqft` : null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: detectListingType(prop.status || prop.description || ''),
          listing_category: 'reo',
          source: 'realtymole',
          source_url: prop.listingUrl || '',
          image_urls: prop.imageUrl ? [prop.imageUrl] : [],
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
  } catch (err: any) {
    console.error(`[Homes][RealtyMole] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  5. RENTCAST API — rentcast.io (requires API key)
//  Real estate listing data with price filters
//  (unchanged from v3.0)
// ============================================================

async function scrapeRentCast(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('rentcast')) return [];
  const items: CheapHomeItem[] = [];
  const apiKey = process.env.RENTCAST_API_KEY;
  if (!apiKey) return items;

  try {
    const response = await httpQueue.add(() =>
      axios.get('https://api.rentcast.io/v1/listings/sale', {
        params: {
          state,
          limit: 50,
          status: 'Active',
          maxPrice: 200000,
          orderBy: 'price',
        },
        headers: {
          'X-Api-Key': apiKey,
          Accept: 'application/json',
        },
        timeout: 15000,
      })
    );

    if (Array.isArray(response?.data)) {
      for (const prop of response.data) {
        items.push({
          title: `${prop.propertyType || 'Property'}: ${prop.formattedAddress || prop.addressLine1}`,
          address: prop.formattedAddress || `${prop.addressLine1}, ${prop.city}, ${prop.state}`,
          city: prop.city || '',
          state: prop.state || state,
          zip: prop.zipCode || '',
          county: prop.county || null,
          price: prop.price || 0,
          original_price: prop.previousPrice || null,
          starting_bid: null,
          assessed_value: null,
          bedrooms: prop.bedrooms || null,
          bathrooms: prop.bathrooms || null,
          sqft: prop.squareFootage || null,
          lot_size: prop.lotSize ? `${prop.lotSize} sqft` : null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: detectListingType(JSON.stringify(prop)),
          listing_category: 'reo',
          source: 'rentcast',
          source_url: prop.listingUrl || '',
          image_urls: prop.imageUrl ? [prop.imageUrl] : [],
          description: null,
          auction_date: null,
          case_number: null,
          parcel_id: null,
          property_status: 'active',
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Homes][RentCast] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  AUCTION/REO SOURCES ORCHESTRATOR — v4.0
//
//  CHANGES FROM v3.0:
//  - Auction.com disabled (client-rendered SPA, no API)
//  - Xome disabled (site completely down)
//  - Still runs Hubzu + RealtyMole + RentCast per state
//  - Auction.com & Xome still called but return [] immediately
//    so the orchestrator shape stays the same for easy re-enable
// ============================================================

export async function scrapeAuctionREOSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  for (const state of states) {
    if (isTimedOut()) {
      console.log(`[Homes][Auction/REO] Timeout after ${statesProcessed} states`);
      break;
    }

    try {
      const [auctionItems, hubzuItems, xomeItems, rmItems, rcItems] = await Promise.allSettled([
        scrapeAuctionCom(state),
        scrapeHubzu(state),
        scrapeXome(state),
        scrapeRealtyMole(state),
        scrapeRentCast(state),
      ]);

      if (auctionItems.status === 'fulfilled') allItems.push(...auctionItems.value);
      if (hubzuItems.status === 'fulfilled') allItems.push(...hubzuItems.value);
      if (xomeItems.status === 'fulfilled') allItems.push(...xomeItems.value);
      if (rmItems.status === 'fulfilled') allItems.push(...rmItems.value);
      if (rcItems.status === 'fulfilled') allItems.push(...rcItems.value);

      statesProcessed++;
    } catch (err: any) {
      console.error(`[Homes][Auction/REO] ${state} error: ${err.message}`);
    }
  }

  console.log(`[Homes][Auction/REO] ${statesProcessed}/${states.length} states | ${allItems.length} items`);
  return allItems;
}
