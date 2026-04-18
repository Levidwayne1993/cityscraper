// ============================================================
//  FILE: src/lib/scrapers/home-sources/auction-reo.ts
//  AUCTION PLATFORMS & BANK-OWNED REO SOURCES
//  
//  Sources:
//    1. Auction.com — largest online real estate auction platform
//    2. Hubzu — online REO auction marketplace
//    3. Xome Auctions — auction & REO platform
//    4. Bank REO Aggregator — scrapes major bank REO pages
//    5. RealtyMole API (if key set)
//    6. RentCast API (if key set)
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
//  1. AUCTION.COM
//  Largest US online auction platform for foreclosures/REO
//  Method: Scrape state-level search results pages
// ============================================================

async function scrapeAuctionCom(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('auction-com')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const stateName = (STATE_NAMES[state] || state).toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.auction.com/residential/${stateName}/`;

    const response = await httpQueue.add(() =>
      axios.get(url, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 25000,
      })
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // Auction.com uses React/Next.js — check for __NEXT_DATA__ or embedded JSON
    const nextDataScript = $('script#__NEXT_DATA__').html();
    if (nextDataScript) {
      try {
        const nextData = JSON.parse(nextDataScript);
        const props = nextData?.props?.pageProps;
        const listings = props?.listings || props?.properties || props?.searchResults?.results || [];

        for (const listing of listings) {
          const addr = listing.address || listing.propertyAddress || {};
          const fullAddress = typeof addr === 'string'
            ? addr
            : `${addr.street || addr.line1 || ''}, ${addr.city || ''}, ${addr.state || state} ${addr.zip || addr.postalCode || ''}`;

          items.push({
            title: `Auction: ${fullAddress}`,
            address: fullAddress,
            city: typeof addr === 'object' ? (addr.city || '') : extractCity(fullAddress),
            state,
            zip: typeof addr === 'object' ? (addr.zip || addr.postalCode || '') : extractZip(fullAddress),
            county: listing.county || null,
            price: listing.currentBid || listing.startingBid || listing.price || 0,
            original_price: listing.estimatedValue || listing.marketValue || null,
            starting_bid: listing.startingBid || listing.openingBid || null,
            assessed_value: listing.assessedValue || null,
            bedrooms: listing.bedrooms || listing.beds || null,
            bathrooms: listing.bathrooms || listing.baths || null,
            sqft: listing.squareFeet || listing.sqft || null,
            lot_size: listing.lotSize || null,
            year_built: listing.yearBuilt || null,
            property_type: detectPropertyType(listing.propertyType || ''),
            listing_type: listing.auctionType?.toLowerCase()?.includes('foreclosure') ? 'foreclosure' : 'auction',
            listing_category: 'auction',
            source: 'auction-com',
            source_url: listing.url || listing.detailUrl || `https://www.auction.com/details/${listing.id || listing.globalPropertyId || ''}`,
            image_urls: listing.photos || listing.images || (listing.primaryPhoto ? [listing.primaryPhoto] : []),
            description: listing.description || null,
            auction_date: listing.auctionDate || listing.saleDate || null,
            case_number: listing.caseNumber || null,
            parcel_id: listing.parcelId || listing.apn || null,
            property_status: listing.status || 'active',
            lat: listing.latitude || listing.lat || null,
            lng: listing.longitude || listing.lng || null,
          });
        }
      } catch (e) {
        // Fall through to HTML parsing
      }
    }

    // Fallback: parse HTML property cards
    if (items.length === 0) {
      $('[class*="property-card"], [class*="auction-card"], [class*="listing-card"], [data-testid*="property"]').each((_, el) => {
        const address = $(el).find('[class*="address"], [class*="location"]').text().trim();
        const priceText = $(el).find('[class*="price"], [class*="bid"]').text().trim();
        const link = $(el).find('a').attr('href') || '';
        const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

        const price = parsePrice(priceText);
        if (!address || address.length < 5) return;

        const text = $(el).text();
        const bedsMatch = text.match(/(\d+)\s*(?:bed|br|bd)/i);
        const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sq|sf)/i);
        const auctionDateMatch = text.match(/(?:auction|sale)\s*(?:date|on)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);

        items.push({
          title: `Auction: ${address}`,
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
          source: 'auction-com',
          source_url: link.startsWith('http') ? link : `https://www.auction.com${link}`,
          image_urls: imgSrc ? [imgSrc] : [],
          description: null,
          auction_date: auctionDateMatch ? auctionDateMatch[1] : null,
          case_number: null,
          parcel_id: null,
          property_status: 'active',
          lat: null,
          lng: null,
        });
      });
    }
  } catch (err: any) {
    console.error(`[Homes][Auction.com] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  2. HUBZU — hubzu.com
//  Online REO auction marketplace
//  Method: Scrape state search results
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
//  3. XOME — xome.com
//  Auction & REO platform (owned by Mr. Cooper)
//  Method: Scrape state search results
// ============================================================

async function scrapeXome(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('xome')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const stateName = (STATE_NAMES[state] || state).toLowerCase().replace(/\s+/g, '-');
    const url = `https://www.xome.com/realestate/${stateName}`;

    const response = await httpQueue.add(() =>
      axios.get(url, {
        params: {
          listingType: 'auction,foreclosure',
          sort: 'price_low',
          page: 1,
        },
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/json',
        },
        timeout: 20000,
      })
    );

    if (!response?.data) return items;

    // Try JSON first
    if (typeof response.data === 'object') {
      const listings = response.data.properties || response.data.results || [];
      for (const prop of listings) {
        const address = prop.address || prop.streetAddress || '';
        if (!address) continue;

        items.push({
          title: `Xome: ${address}`,
          address: prop.fullAddress || `${address}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
          city: prop.city || '',
          state,
          zip: prop.zip || prop.zipCode || '',
          county: prop.county || null,
          price: prop.price || prop.currentBid || 0,
          original_price: prop.estimatedValue || null,
          starting_bid: prop.startingBid || null,
          assessed_value: null,
          bedrooms: prop.bedrooms || null,
          bathrooms: prop.bathrooms || null,
          sqft: prop.sqft || prop.squareFeet || null,
          lot_size: prop.lotSize || null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: detectListingType(prop.saleType || prop.listingType || 'auction'),
          listing_category: 'auction',
          source: 'xome',
          source_url: prop.url || `https://www.xome.com/property/${prop.id || ''}`,
          image_urls: prop.photos || [],
          description: prop.description || null,
          auction_date: prop.auctionDate || null,
          case_number: null,
          parcel_id: null,
          property_status: prop.status || 'active',
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    } else {
      // HTML parsing
      const $ = cheerio.load(response.data);

      // Check for Next.js data
      const nextData = $('script#__NEXT_DATA__').html();
      if (nextData) {
        try {
          const parsed = JSON.parse(nextData);
          const listings = parsed?.props?.pageProps?.listings || parsed?.props?.pageProps?.properties || [];
          for (const prop of listings) {
            const addr = prop.address || '';
            if (!addr) continue;
            items.push({
              title: `Xome: ${addr}`,
              address: `${addr}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
              city: prop.city || '',
              state,
              zip: prop.zip || '',
              county: prop.county || null,
              price: prop.price || prop.listPrice || 0,
              original_price: null,
              starting_bid: prop.startingBid || null,
              assessed_value: null,
              bedrooms: prop.bedrooms || null,
              bathrooms: prop.bathrooms || null,
              sqft: prop.sqft || null,
              lot_size: null,
              year_built: prop.yearBuilt || null,
              property_type: detectPropertyType(prop.propertyType || ''),
              listing_type: 'auction',
              listing_category: 'auction',
              source: 'xome',
              source_url: prop.url || `https://www.xome.com`,
              image_urls: prop.photos || [],
              description: null,
              auction_date: prop.auctionDate || null,
              case_number: null,
              parcel_id: null,
              property_status: 'active',
              lat: prop.latitude || null,
              lng: prop.longitude || null,
            });
          }
        } catch (e) { /* skip */ }
      }

      // Standard HTML card parsing
      if (items.length === 0) {
        $('[class*="property"], [class*="listing"], [class*="result"]').each((_, el) => {
          const address = $(el).find('[class*="address"]').text().trim();
          const priceText = $(el).find('[class*="price"]').text().trim();
          const link = $(el).find('a').attr('href') || '';
          const imgSrc = $(el).find('img').attr('src') || '';
          const price = parsePrice(priceText);
          if (!address || address.length < 5) return;

          const text = $(el).text();
          const bedsMatch = text.match(/(\d+)\s*(?:bed|br|bd)/i);
          const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
          const sqftMatch = text.match(/([\d,]+)\s*(?:sq|sf)/i);

          items.push({
            title: `Xome: ${address}`,
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
            listing_type: 'auction',
            listing_category: 'auction',
            source: 'xome',
            source_url: link.startsWith('http') ? link : `https://www.xome.com${link}`,
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
    }
  } catch (err: any) {
    console.error(`[Homes][Xome] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  4. REALTYMOLE API — rapidapi.com (requires API key)
//  Real estate data API with foreclosure/distressed filters
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
//  AUCTION/REO SOURCES ORCHESTRATOR
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
