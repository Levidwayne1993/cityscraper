// ============================================================
//  FILE: src/lib/scrapers/home-sources/government.ts
//  GOVERNMENT & FEDERAL SOURCES
//  
//  Sources:
//    1. HUD HomeStore (hudhomestore.gov) — FHA foreclosures
//    2. Fannie Mae HomePath (homepath.fanniemae.com) — Fannie REO
//    3. USDA RD/FSA (properties.sc.egov.usda.gov) — Rural dev properties
//    4. Freddie Mac HomeSteps (homesteps.freddiemac.com) — Freddie REO
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
//  1. HUD HOMESTORE — hudhomestore.gov
//  FHA-insured foreclosed properties sold by HUD
//  Method: POST to search endpoint, parse HTML results
// ============================================================

async function scrapeHUDHomeStore(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('hud-homestore')) return [];
  const items: CheapHomeItem[] = [];

  try {
    // HUD uses a POST form-based search
    const searchUrl = 'https://www.hudhomestore.gov/Listing/PropertySearchResult';
    
    const response = await httpQueue.add(() =>
      axios.post(searchUrl, 
        new URLSearchParams({
          sState: state,
          iPageSize: '100',
          sOrderBy: 'DLISTPRICE',
          sOrderByDirection: 'ASC',
          sPropType: '',
          sStatus: 'Available',
        }).toString(),
        {
          headers: {
            'User-Agent': getRandomUA(),
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml',
            'Referer': 'https://www.hudhomestore.gov/Listing/PropertySearchResult',
          },
          timeout: 25000,
        }
      )
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // HUD HomeStore uses table-based results with specific class patterns
    // Try multiple selector strategies since they update their HTML periodically
    const selectors = [
      'table.table tbody tr',
      '.search-results .result-row',
      '.property-listing',
      'div[class*="property"]',
      'tr[data-property]',
    ];

    let foundRows = false;
    for (const selector of selectors) {
      const rows = $(selector);
      if (rows.length === 0) continue;
      foundRows = true;

      rows.each((_, el) => {
        try {
          // Extract data from table cells or div elements
          const cells = $(el).find('td');
          const allText = $(el).text();

          let address = '';
          let priceText = '';
          let cityText = '';
          let zipText = '';
          let bedsText = '';
          let bathsText = '';
          let sqftText = '';
          let link = '';
          let caseNum = '';

          if (cells.length >= 4) {
            // Table layout: Address | City | State | Zip | Price | Beds | Baths | Sqft
            address = cells.eq(0).text().trim();
            cityText = cells.eq(1).text().trim();
            zipText = cells.eq(3).text().trim();
            priceText = cells.eq(4).text().trim() || cells.eq(3).text().trim();
          } else {
            // Div-based layout
            address = $(el).find('[class*="address"], .addr, a').first().text().trim();
            priceText = $(el).find('[class*="price"]').text().trim();
            cityText = $(el).find('[class*="city"]').text().trim();
          }

          // Extract link
          const linkEl = $(el).find('a[href*="Property"], a[href*="listing"], a[href*="detail"]').first();
          link = linkEl.attr('href') || '';

          // Extract case number if available
          const caseMatch = allText.match(/(?:Case|FHA)\s*#?\s*[:.]?\s*(\d[\d-]+)/i);
          if (caseMatch) caseNum = caseMatch[1];

          // Try to find beds/baths/sqft from text
          const bedsMatch = allText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
          const bathsMatch = allText.match(/(\d+\.?\d*)\s*(?:bath|ba|bathroom)/i);
          const sqftMatch = allText.match(/([\d,]+)\s*(?:sq\s*ft|sqft|sf)/i);

          const price = parsePrice(priceText);
          if (!address || address.length < 5) return;

          // Build full address
          const fullAddress = cityText
            ? `${address}, ${cityText}, ${state} ${zipText}`.trim()
            : address;

          items.push({
            title: `HUD Home: ${address}`,
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
            listing_type: 'hud',
            listing_category: 'government',
            source: 'hud-homestore',
            source_url: link.startsWith('http') ? link : `https://www.hudhomestore.gov${link}`,
            image_urls: [],
            description: null,
            auction_date: null,
            case_number: caseNum || null,
            parcel_id: null,
            property_status: 'active',
            lat: null,
            lng: null,
          });
        } catch (e) {
          // Skip malformed rows
        }
      });

      if (foundRows) break;
    }

    // Fallback: Try parsing from JSON embedded in page (some pages embed data in script tags)
    if (!foundRows) {
      const scriptTags = $('script');
      scriptTags.each((_, el) => {
        const content = $(el).html() || '';
        // Look for JSON property data embedded in scripts
        const jsonMatch = content.match(/(?:properties|listings|results)\s*[:=]\s*(\[[\s\S]*?\]);/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[1]);
            if (Array.isArray(data)) {
              for (const prop of data) {
                if (prop.address || prop.streetAddress) {
                  items.push({
                    title: `HUD Home: ${prop.address || prop.streetAddress}`,
                    address: prop.formattedAddress || `${prop.address || prop.streetAddress}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
                    city: prop.city || '',
                    state,
                    zip: prop.zip || prop.zipCode || '',
                    county: null,
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
                    source_url: prop.url || prop.detailUrl || `https://www.hudhomestore.gov`,
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
            }
          } catch (e) {
            // JSON parse failed, skip
          }
        }
      });
    }
  } catch (err: any) {
    console.error(`[Homes][HUD] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  2. FANNIE MAE HOMEPATH — homepath.fanniemae.com
//  Fannie Mae-owned REO properties
//  Method: Search API endpoint (returns JSON)
// ============================================================

async function scrapeHomePath(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('homepath')) return [];
  const items: CheapHomeItem[] = [];

  try {
    // HomePath has a property search that can be queried by state
    // Try their search/listing pages
    const stateName = STATE_NAMES[state] || state;
    const searchUrl = `https://www.homepath.fanniemae.com/listing/search`;
    
    const response = await httpQueue.add(() =>
      axios.get(searchUrl, {
        params: {
          state: stateName,
          propertyType: 'SFR,CONDO,TOWN',
          maxPrice: 200000,
          pageSize: 50,
          page: 1,
        },
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'application/json, text/html',
        },
        timeout: 20000,
      })
    );

    if (!response?.data) return items;

    // Check if response is JSON (API) or HTML
    if (typeof response.data === 'object' && response.data.properties) {
      // JSON API response
      const properties = response.data.properties || response.data.results || [];
      for (const prop of properties) {
        const address = prop.address || prop.streetAddress || '';
        if (!address) continue;

        items.push({
          title: `HomePath: ${address}`,
          address: prop.fullAddress || `${address}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
          city: prop.city || '',
          state,
          zip: prop.zip || prop.zipCode || '',
          county: prop.county || null,
          price: prop.listPrice || prop.price || 0,
          original_price: prop.originalPrice || null,
          starting_bid: null,
          assessed_value: null,
          bedrooms: prop.bedrooms || prop.beds || null,
          bathrooms: prop.bathrooms || prop.baths || null,
          sqft: prop.squareFeet || prop.sqft || null,
          lot_size: prop.lotSize || null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: 'reo',
          listing_category: 'government',
          source: 'homepath',
          source_url: prop.listingUrl || prop.url || `https://www.homepath.fanniemae.com/listing/${prop.id || ''}`,
          image_urls: prop.photos || prop.images || [],
          description: prop.description || prop.remarks || null,
          auction_date: null,
          case_number: prop.caseNumber || prop.listingId || null,
          parcel_id: null,
          property_status: prop.status || 'active',
          lat: prop.latitude || prop.lat || null,
          lng: prop.longitude || prop.lng || null,
        });
      }
    } else if (typeof response.data === 'string') {
      // HTML response — parse with Cheerio
      const $ = cheerio.load(response.data);
      
      // Look for property cards/listings
      $('[class*="property"], [class*="listing"], [class*="card"]').each((_, el) => {
        const address = $(el).find('[class*="address"], [class*="addr"]').text().trim();
        const priceText = $(el).find('[class*="price"]').text().trim();
        const link = $(el).find('a').attr('href') || '';
        const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';

        const price = parsePrice(priceText);
        if (!address || address.length < 5) return;

        const text = $(el).text();
        const bedsMatch = text.match(/(\d+)\s*(?:bed|br)/i);
        const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sq|sf)/i);

        items.push({
          title: `HomePath: ${address}`,
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
          listing_type: 'reo',
          listing_category: 'government',
          source: 'homepath',
          source_url: link.startsWith('http') ? link : `https://www.homepath.fanniemae.com${link}`,
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

      // Also check for embedded JSON data
      $('script[type="application/json"], script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html() || '');
          // Process LD+JSON structured data
          if (data['@type'] === 'RealEstateListing' || data['@type'] === 'Product') {
            items.push({
              title: `HomePath: ${data.name || data.address?.streetAddress || ''}`,
              address: data.address ? `${data.address.streetAddress}, ${data.address.addressLocality}, ${data.address.addressRegion} ${data.address.postalCode}` : '',
              city: data.address?.addressLocality || '',
              state: data.address?.addressRegion || state,
              zip: data.address?.postalCode || '',
              county: null,
              price: parsePrice(data.offers?.price || data.price || '0'),
              original_price: null,
              starting_bid: null,
              assessed_value: null,
              bedrooms: data.numberOfBedrooms || null,
              bathrooms: data.numberOfBathroomsTotal || null,
              sqft: data.floorSize?.value || null,
              lot_size: null,
              year_built: null,
              property_type: 'single-family',
              listing_type: 'reo',
              listing_category: 'government',
              source: 'homepath',
              source_url: data.url || `https://www.homepath.fanniemae.com`,
              image_urls: data.image ? (Array.isArray(data.image) ? data.image : [data.image]) : [],
              description: data.description || null,
              auction_date: null,
              case_number: null,
              parcel_id: null,
              property_status: 'active',
              lat: data.geo?.latitude || null,
              lng: data.geo?.longitude || null,
            });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      });
    }
  } catch (err: any) {
    console.error(`[Homes][HomePath] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  3. USDA RD/FSA — properties.sc.egov.usda.gov
//  Government-owned rural development & farm service properties
//  Method: State-based search on USDA properties site
// ============================================================

async function scrapeUSDA(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('usda')) return [];
  const items: CheapHomeItem[] = [];

  try {
    // USDA RD/FSA property search
    const searchUrl = 'https://properties.sc.egov.usda.gov/resales/index.jsp';
    
    // First, do a state search
    const response = await httpQueue.add(() =>
      axios.get(searchUrl, {
        params: {
          state: state,
          type: 'SFH', // Single Family Housing
        },
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html',
        },
        timeout: 25000,
      })
    );

    if (!response?.data) return items;
    const $ = cheerio.load(response.data);

    // Parse property listing results
    // USDA site typically uses a table or list format
    $('table tr, .property-row, .listing-item').each((i, el) => {
      if (i === 0) return; // Skip header row
      
      const cells = $(el).find('td');
      const allText = $(el).text();

      if (cells.length < 3 && !$(el).find('[class*="address"]').length) return;

      let address = '';
      let cityText = '';
      let zipText = '';
      let priceText = '';
      let propType = '';

      if (cells.length >= 4) {
        address = cells.eq(0).text().trim() || cells.eq(1).text().trim();
        cityText = cells.eq(1).text().trim() || cells.eq(2).text().trim();
        priceText = allText.match(/\$[\d,.]+/)?.[0] || '';
      } else {
        address = $(el).find('[class*="address"]').text().trim() || $(el).find('a').first().text().trim();
        priceText = $(el).find('[class*="price"]').text().trim();
        cityText = $(el).find('[class*="city"]').text().trim();
      }

      const link = $(el).find('a').attr('href') || '';
      const price = parsePrice(priceText);

      if (!address || address.length < 5) return;

      const bedsMatch = allText.match(/(\d+)\s*(?:bed|br|bedroom)/i);
      const bathsMatch = allText.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
      const sqftMatch = allText.match(/([\d,]+)\s*(?:sq|sf)/i);

      const fullAddress = cityText
        ? `${address}, ${cityText}, ${state} ${zipText}`.trim()
        : address;

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
        property_type: detectPropertyType(propType || allText),
        listing_type: 'usda',
        listing_category: 'government',
        source: 'usda',
        source_url: link.startsWith('http') ? link : `https://properties.sc.egov.usda.gov${link}`,
        image_urls: [],
        description: null,
        auction_date: null,
        case_number: null,
        parcel_id: null,
        property_status: 'active',
        lat: null,
        lng: null,
      });
    });
  } catch (err: any) {
    console.error(`[Homes][USDA] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  4. FREDDIE MAC HOMESTEPS — homesteps.freddiemac.com
//  Freddie Mac REO properties
//  Method: Search/listing pages
// ============================================================

async function scrapeHomeSteps(state: string): Promise<CheapHomeItem[]> {
  if (!isSourceEnabled('homesteps')) return [];
  const items: CheapHomeItem[] = [];

  try {
    const stateName = STATE_NAMES[state] || state;
    
    // HomeSteps property search
    const searchUrl = `https://www.homesteps.com/listings`;
    
    const response = await httpQueue.add(() =>
      axios.get(searchUrl, {
        params: {
          state: stateName,
          page: 1,
          pageSize: 50,
          sortBy: 'price',
          sortDir: 'asc',
        },
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html, application/json',
        },
        timeout: 20000,
      })
    );

    if (!response?.data) return items;

    // Try JSON first
    if (typeof response.data === 'object') {
      const properties = response.data.listings || response.data.properties || response.data.results || [];
      for (const prop of properties) {
        if (!prop.address && !prop.streetAddress) continue;

        items.push({
          title: `HomeSteps: ${prop.address || prop.streetAddress}`,
          address: prop.fullAddress || `${prop.address || prop.streetAddress}, ${prop.city || ''}, ${state} ${prop.zip || ''}`,
          city: prop.city || '',
          state,
          zip: prop.zip || prop.zipCode || '',
          county: prop.county || null,
          price: prop.listPrice || prop.price || 0,
          original_price: null,
          starting_bid: null,
          assessed_value: null,
          bedrooms: prop.bedrooms || null,
          bathrooms: prop.bathrooms || null,
          sqft: prop.squareFeet || prop.sqft || null,
          lot_size: prop.lotSize || null,
          year_built: prop.yearBuilt || null,
          property_type: detectPropertyType(prop.propertyType || ''),
          listing_type: 'reo',
          listing_category: 'government',
          source: 'homesteps',
          source_url: prop.url || prop.listingUrl || `https://www.homesteps.com/listing/${prop.id || ''}`,
          image_urls: prop.photos || prop.images || [],
          description: prop.description || null,
          auction_date: null,
          case_number: prop.listingId || null,
          parcel_id: null,
          property_status: prop.status || 'active',
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    } else {
      // HTML response
      const $ = cheerio.load(response.data);
      
      $('[class*="listing"], [class*="property"], [class*="card"]').each((_, el) => {
        const address = $(el).find('[class*="address"]').text().trim();
        const priceText = $(el).find('[class*="price"]').text().trim();
        const link = $(el).find('a').attr('href') || '';
        const imgSrc = $(el).find('img').attr('src') || '';

        const price = parsePrice(priceText);
        if (!address || address.length < 5) return;

        const text = $(el).text();
        const bedsMatch = text.match(/(\d+)\s*(?:bed|br)/i);
        const bathsMatch = text.match(/(\d+\.?\d*)\s*(?:bath|ba)/i);
        const sqftMatch = text.match(/([\d,]+)\s*(?:sq|sf)/i);

        items.push({
          title: `HomeSteps: ${address}`,
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
          listing_type: 'reo',
          listing_category: 'government',
          source: 'homesteps',
          source_url: link.startsWith('http') ? link : `https://www.homesteps.com${link}`,
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
    console.error(`[Homes][HomeSteps] ${state} error: ${err.message}`);
  }

  return items;
}

// ============================================================
//  GOVERNMENT SOURCES ORCHESTRATOR
// ============================================================

export async function scrapeGovernmentSources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];
  let statesProcessed = 0;

  for (const state of states) {
    if (isTimedOut()) {
      console.log(`[Homes][Gov] Timeout after ${statesProcessed} states`);
      break;
    }

    try {
      // Run all government sources for this state in parallel
      const [hudItems, homePathItems, usdaItems, homeStepsItems] = await Promise.allSettled([
        scrapeHUDHomeStore(state),
        scrapeHomePath(state),
        scrapeUSDA(state),
        scrapeHomeSteps(state),
      ]);

      if (hudItems.status === 'fulfilled') allItems.push(...hudItems.value);
      if (homePathItems.status === 'fulfilled') allItems.push(...homePathItems.value);
      if (usdaItems.status === 'fulfilled') allItems.push(...usdaItems.value);
      if (homeStepsItems.status === 'fulfilled') allItems.push(...homeStepsItems.value);

      statesProcessed++;
    } catch (err: any) {
      console.error(`[Homes][Gov] ${state} error: ${err.message}`);
    }
  }

  console.log(`[Homes][Gov] ${statesProcessed}/${states.length} states | ${allItems.length} items`);
  return allItems;
}
