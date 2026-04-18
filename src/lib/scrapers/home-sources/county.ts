// ============================================================
//  FILE: src/lib/scrapers/home-sources/county.ts
//  COUNTY-LEVEL PUBLIC RECORDS — THE GOLD MINE
//  
//  Sources:
//    1. County Sheriff Sale Listings — foreclosure auctions
//    2. Tax Lien / Tax Deed Sales — delinquent property taxes
//    3. County Foreclosure Notices — lis pendens, NOD filings
//
//  ARCHITECTURE NOTE:
//  County sources are the hardest to scale because every county
//  has a different website. This module uses a registry of known
//  county URLs organized by state. Start with high-population
//  counties and expand over time.
//
//  To add a new county:
//  1. Find the county's sheriff sale / tax sale / foreclosure page
//  2. Add it to the COUNTY_SOURCES registry below
//  3. The generic scraper will attempt to parse it
//  4. If the format is unusual, add a custom parser function
// ============================================================

import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  CheapHomeItem,
  httpQueue,
  getRandomUA,
  parsePrice,
  extractZip,
  isValidAddress,
  detectPropertyType,
  isSourceEnabled,
} from '../home-scraper';

// ============================================================
//  COUNTY SOURCE REGISTRY
//  Add counties as you discover their public records URLs
//  Format: { state, county, type, url, parser? }
// ============================================================

interface CountySource {
  state: string;
  county: string;
  type: 'sheriff-sale' | 'tax-sale' | 'foreclosure-notice';
  url: string;
  // Optional custom parser ID — if not set, uses generic parser
  parserId?: string;
}

// ---- INITIAL COUNTY REGISTRY ----
// Starting with high-population counties across multiple states
// These are PUBLIC RECORD sites — freely accessible
const COUNTY_SOURCES: CountySource[] = [
  // === FLORIDA (judicial foreclosure state — lots of sheriff sales) ===
  { state: 'FL', county: 'Miami-Dade',   type: 'sheriff-sale',      url: 'https://www.miamidade.gov/global/service.page?Mduid_service=ser1504717951498586' },
  { state: 'FL', county: 'Broward',      type: 'sheriff-sale',      url: 'https://www.browardsheriff.org/CivilProcess/ForeclosureSales' },
  { state: 'FL', county: 'Palm Beach',   type: 'sheriff-sale',      url: 'https://www.mypalmbeachclerk.com/foreclosure-sales' },
  { state: 'FL', county: 'Hillsborough', type: 'sheriff-sale',      url: 'https://www.hillsclerk.com/Foreclosure-Sales' },
  { state: 'FL', county: 'Orange',       type: 'sheriff-sale',      url: 'https://www.myorangeclerk.com/foreclosure-sales' },
  { state: 'FL', county: 'Duval',        type: 'sheriff-sale',      url: 'https://www.duvalclerk.com/foreclosure-sale-dates' },
  { state: 'FL', county: 'Pinellas',     type: 'sheriff-sale',      url: 'https://www.mypinellasclerk.org/foreclosure-sales' },

  // === OHIO (non-judicial — sheriff sales are huge) ===
  { state: 'OH', county: 'Cuyahoga',     type: 'sheriff-sale',      url: 'https://fiscalofficer.cuyahogacounty.us/en-US/sheriff-sales.aspx' },
  { state: 'OH', county: 'Franklin',     type: 'sheriff-sale',      url: 'https://sheriff.franklincountyohio.gov/Property-Sales/Sheriff-Sales' },
  { state: 'OH', county: 'Hamilton',     type: 'sheriff-sale',      url: 'https://www.hcso.org/civil-division/real-estate-sales/' },
  { state: 'OH', county: 'Summit',       type: 'sheriff-sale',      url: 'https://www.co.summit.oh.us/sheriff/civilForeclosureSales.aspx' },
  { state: 'OH', county: 'Montgomery',   type: 'sheriff-sale',      url: 'https://www.mcohio.org/sales' },

  // === TEXAS (non-judicial — trustee sales on courthouse steps) ===
  { state: 'TX', county: 'Harris',       type: 'foreclosure-notice', url: 'https://www.hctax.net/Property/ForeclosureList' },
  { state: 'TX', county: 'Dallas',       type: 'foreclosure-notice', url: 'https://www.dallascounty.org/government/constable/precinct1/sales/' },
  { state: 'TX', county: 'Bexar',        type: 'foreclosure-notice', url: 'https://www.bexar.org/3372/Constable-Sales' },
  { state: 'TX', county: 'Tarrant',      type: 'foreclosure-notice', url: 'https://www.tarrantcounty.com/en/constable/precinct-1/property-sales.html' },
  { state: 'TX', county: 'Travis',       type: 'foreclosure-notice', url: 'https://www.traviscountytx.gov/constables/1/sales' },

  // === GEORGIA ===
  { state: 'GA', county: 'Fulton',       type: 'foreclosure-notice', url: 'https://www.fultoncountyga.gov/services/foreclosure-notices' },
  { state: 'GA', county: 'DeKalb',       type: 'sheriff-sale',      url: 'https://www.dekalbcountyga.gov/sheriff/marshal-sales' },
  { state: 'GA', county: 'Gwinnett',     type: 'foreclosure-notice', url: 'https://www.gwinnettcounty.com/web/gwinnett/departments/clerkofcourt/foreclosures' },

  // === MICHIGAN ===
  { state: 'MI', county: 'Wayne',        type: 'tax-sale',          url: 'https://www.waynecounty.com/elected/treasurer/tax-foreclosure.aspx' },
  { state: 'MI', county: 'Oakland',      type: 'sheriff-sale',      url: 'https://www.oakgov.com/sheriff/Pages/sheriff-sales.aspx' },
  { state: 'MI', county: 'Macomb',       type: 'sheriff-sale',      url: 'https://sheriff.macombgov.org/Sheriff-CivilSalesInfo' },

  // === ILLINOIS ===
  { state: 'IL', county: 'Cook',         type: 'sheriff-sale',      url: 'https://www.cookcountysheriff.org/real-estate-sales/' },
  { state: 'IL', county: 'DuPage',       type: 'sheriff-sale',      url: 'https://www.dupagesheriff.org/civil-process/judicial-sales/' },

  // === PENNSYLVANIA ===
  { state: 'PA', county: 'Philadelphia', type: 'sheriff-sale',      url: 'https://www.officeofphiladelphiasheriff.com/en/real-estate/listing' },
  { state: 'PA', county: 'Allegheny',    type: 'sheriff-sale',      url: 'https://www.sheriffallegheny.com/SaleListings.aspx' },

  // === NEW YORK ===
  { state: 'NY', county: 'Kings',        type: 'foreclosure-notice', url: 'https://a836-acris.nyc.gov/CP/LisPendens/LisPendensBblSearch' },
  { state: 'NY', county: 'Suffolk',      type: 'sheriff-sale',      url: 'https://www.suffolkcountyny.gov/Departments/Sheriff/Real-Property-Auction' },

  // === NEW JERSEY ===
  { state: 'NJ', county: 'Essex',        type: 'sheriff-sale',      url: 'https://www.essexsheriff.com/sheriffs-sale/' },
  { state: 'NJ', county: 'Hudson',       type: 'sheriff-sale',      url: 'https://www.hudsoncountynj.org/sheriff-sales' },
  { state: 'NJ', county: 'Bergen',       type: 'sheriff-sale',      url: 'https://www.bcsd.us/sheriff-sales/' },

  // === NORTH CAROLINA ===
  { state: 'NC', county: 'Mecklenburg',  type: 'foreclosure-notice', url: 'https://www.mecknc.gov/CountyManagersOffice/TaxCollections/Pages/Foreclosures.aspx' },
  { state: 'NC', county: 'Wake',         type: 'tax-sale',          url: 'https://www.wakegov.com/tax-administration/tax-foreclosure-properties' },

  // === INDIANA ===
  { state: 'IN', county: 'Marion',       type: 'sheriff-sale',      url: 'https://www.indy.gov/activity/sheriff-sales' },
  { state: 'IN', county: 'Lake',         type: 'sheriff-sale',      url: 'https://www.lakecountyin.org/departments/sheriff/sheriff_sales.php' },

  // === MARYLAND ===
  { state: 'MD', county: 'Baltimore',    type: 'tax-sale',          url: 'https://taxsale.baltimorecity.gov/' },
  { state: 'MD', county: 'Prince George', type: 'tax-sale',         url: 'https://www.princegeorgescountymd.gov/departments-offices/finance/tax-sale' },

  // === WASHINGTON ===
  { state: 'WA', county: 'King',         type: 'sheriff-sale',      url: 'https://kingcounty.gov/en/dept/dajd/courts-jails-background-checks/sheriff/foreclosure-sales' },
  { state: 'WA', county: 'Pierce',       type: 'sheriff-sale',      url: 'https://www.piercecountywa.gov/1184/Foreclosure-Sales' },
  { state: 'WA', county: 'Thurston',     type: 'tax-sale',          url: 'https://www.thurstoncountywa.gov/treasurer/tax-foreclosure-sales' },

  // === ARIZONA ===
  { state: 'AZ', county: 'Maricopa',     type: 'sheriff-sale',      url: 'https://www.mcso.org/Home/CivilSales' },
  { state: 'AZ', county: 'Pima',         type: 'sheriff-sale',      url: 'https://www.pimasheriff.org/civil/real-property-sales' },

  // === NEVADA ===
  { state: 'NV', county: 'Clark',        type: 'foreclosure-notice', url: 'https://www.clarkcountynv.gov/government/elected_officials/county_recorder/foreclosures.php' },

  // === COLORADO ===
  { state: 'CO', county: 'Denver',       type: 'sheriff-sale',      url: 'https://www.denvergov.org/Government/Departments/Department-of-Safety/Sheriff-Department/Sheriff-Sales' },
  { state: 'CO', county: 'El Paso',      type: 'sheriff-sale',      url: 'https://www.epcsheriffsoffice.com/sheriff-sales' },

  // === TENNESSEE ===
  { state: 'TN', county: 'Shelby',       type: 'tax-sale',          url: 'https://www.shelbycountytn.gov/448/Tax-Sale' },
  { state: 'TN', county: 'Davidson',     type: 'sheriff-sale',      url: 'https://www.nashville.gov/departments/sheriff/civil-warrants/real-property-sales' },

  // === ALABAMA ===
  { state: 'AL', county: 'Jefferson',    type: 'tax-sale',          url: 'https://www.jccal.org/Default.asp?ID=542' },

  // === SOUTH CAROLINA ===
  { state: 'SC', county: 'Charleston',   type: 'sheriff-sale',      url: 'https://www.charlestoncounty.org/departments/sheriff/sales.php' },
  { state: 'SC', county: 'Richland',     type: 'sheriff-sale',      url: 'https://www.rcgov.us/Government/SheriffsOffice/CivilProcess/SheriffsSales' },

  // === LOUISIANA ===
  { state: 'LA', county: 'Orleans',      type: 'sheriff-sale',      url: 'https://www.opcso.org/index.php?option=com_content&view=article&id=57' },
  { state: 'LA', county: 'East Baton Rouge', type: 'sheriff-sale',  url: 'https://www.ebrso.org/Divisions/Judicial-Sales' },

  // === MISSOURI ===
  { state: 'MO', county: 'St. Louis City', type: 'sheriff-sale',    url: 'https://www.stlouis-mo.gov/government/departments/sheriff/foreclosure-sales/' },
  { state: 'MO', county: 'Jackson',      type: 'sheriff-sale',      url: 'https://www.jacksoncountygov.com/3218/Sheriff-Sales' },

  // === WISCONSIN ===
  { state: 'WI', county: 'Milwaukee',    type: 'sheriff-sale',      url: 'https://county.milwaukee.gov/EN/Sheriff/Sheriff-Sales' },

  // === MINNESOTA ===
  { state: 'MN', county: 'Hennepin',     type: 'sheriff-sale',      url: 'https://www.hennepin.us/residents/property/sheriff-sale' },
  { state: 'MN', county: 'Ramsey',       type: 'tax-sale',          url: 'https://www.ramseycounty.us/residents/property-home/taxes-tax-statements/tax-forfeited-land' },

  // === OKLAHOMA ===
  { state: 'OK', county: 'Oklahoma',     type: 'sheriff-sale',      url: 'https://www.oklahomacounty.org/sheriff/sheriff-sales/' },
  { state: 'OK', county: 'Tulsa',        type: 'sheriff-sale',      url: 'https://www.tcso.org/sheriff-sales/' },

  // === MISSISSIPPI ===
  { state: 'MS', county: 'Hinds',        type: 'tax-sale',          url: 'https://www.co.hinds.ms.us/pgs/apps/taxsales.asp' },

  // === ARKANSAS ===
  { state: 'AR', county: 'Pulaski',      type: 'tax-sale',          url: 'https://www.pulaskicounty.net/tax-collector/tax-sale' },

  // === KENTUCKY ===
  { state: 'KY', county: 'Jefferson',    type: 'sheriff-sale',      url: 'https://www.jcsoky.org/divisions/court-services/foreclosure-sales/' },
  { state: 'KY', county: 'Fayette',      type: 'sheriff-sale',      url: 'https://www.fayettecountyclerk.com/foreclosures' },
];

// ============================================================
//  GENERIC COUNTY PAGE PARSER
//  Attempts to extract property listings from any county page
//  Uses heuristics to find addresses, prices, dates, case #s
// ============================================================

async function scrapeCountyPage(source: CountySource): Promise<CheapHomeItem[]> {
  const items: CheapHomeItem[] = [];

  try {
    const response = await httpQueue.add(() =>
      axios.get(source.url, {
        headers: {
          'User-Agent': getRandomUA(),
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 25000,
        maxRedirects: 3,
      })
    );

    if (!response?.data || typeof response.data !== 'string') return items;
    const $ = cheerio.load(response.data);

    // Strategy 1: Look for tables with property data
    $('table').each((_, table) => {
      const headers = $(table).find('th, thead td').map((_, th) => $(th).text().trim().toLowerCase()).get();
      
      // Check if this table has property-related headers
      const hasAddressCol = headers.some(h => /address|location|property|parcel|street/.test(h));
      const hasPriceCol = headers.some(h => /price|amount|bid|value|judgment|balance/.test(h));
      
      if (!hasAddressCol && !hasPriceCol) return;

      $(table).find('tbody tr, tr').each((i, row) => {
        if (i === 0 && $(row).find('th').length > 0) return; // Skip header row
        
        const cells = $(row).find('td');
        if (cells.length < 2) return;

        const rowText = $(row).text();
        
        // Extract address — look for street address pattern
        let address = '';
        cells.each((_, cell) => {
          const cellText = $(cell).text().trim();
          if (/^\d+\s+\S+/.test(cellText) && cellText.length > 10 && cellText.length < 200) {
            if (!address || cellText.length > address.length) {
              address = cellText;
            }
          }
        });

        // If no address found in cells, try regex on full row
        if (!address) {
          const addrMatch = rowText.match(/(\d+\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Cir|Ter|Pkwy|Hwy)[.,\s]*(?:[A-Za-z\s]+)?)/);
          if (addrMatch) address = addrMatch[1].trim();
        }

        if (!address || !isValidAddress(address)) return;

        // Extract price
        const priceMatch = rowText.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

        // Extract case number
        const caseMatch = rowText.match(/(?:case|docket|file)\s*(?:#|no\.?|number)?\s*:?\s*([\w-]+)/i);

        // Extract sale date
        const dateMatch = rowText.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);

        // Extract parcel ID / APN
        const parcelMatch = rowText.match(/(?:parcel|apn|pin|folio)\s*(?:#|no\.?)?\s*:?\s*([\d\-\.]+)/i);

        // Map source type to listing type
        const listingType = source.type === 'sheriff-sale' ? 'sheriff-sale'
          : source.type === 'tax-sale' ? 'tax-lien'
          : 'foreclosure';

        items.push({
          title: `${source.county} County ${listingType}: ${address}`,
          address: `${address}, ${source.county}, ${source.state}`,
          city: source.county,
          state: source.state,
          zip: extractZip(address),
          county: source.county,
          price,
          original_price: null,
          starting_bid: price > 0 ? price : null,
          assessed_value: null,
          bedrooms: null,
          bathrooms: null,
          sqft: null,
          lot_size: null,
          year_built: null,
          property_type: 'single-family',
          listing_type: listingType,
          listing_category: 'county_public',
          source: `county-${source.type}`,
          source_url: source.url,
          image_urls: [],
          description: `${source.county} County ${source.type.replace(/-/g, ' ')} — public record`,
          auction_date: dateMatch ? dateMatch[1] : null,
          case_number: caseMatch ? caseMatch[1] : null,
          parcel_id: parcelMatch ? parcelMatch[1] : null,
          property_status: 'upcoming',
          lat: null,
          lng: null,
        });
      });
    });

    // Strategy 2: Look for list items or divs with property data
    if (items.length === 0) {
      // Try to find property blocks in non-table formats
      const propertyBlocks = $('li, .property, .listing, .sale-item, .result-item, [class*="foreclosure"], [class*="sale"]')
        .filter((_, el) => {
          const text = $(el).text();
          return /\d+\s+\S+/.test(text) && /\$[\d,]+/.test(text);
        });

      propertyBlocks.each((_, el) => {
        const text = $(el).text();
        
        const addrMatch = text.match(/(\d+\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Rd|Dr|Ln|Ct|Blvd|Way|Pl|Cir|Ter|Pkwy)[.,\s]*(?:[A-Za-z\s]+)?)/);
        const priceMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
        const dateMatch = text.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
        const caseMatch = text.match(/(?:case|docket)\s*#?\s*:?\s*([\w-]+)/i);
        const parcelMatch = text.match(/(?:parcel|apn|pin)\s*#?\s*:?\s*([\d\-\.]+)/i);

        if (!addrMatch) return;
        const address = addrMatch[1].trim();
        if (!isValidAddress(address)) return;

        const price = priceMatch ? parsePrice(priceMatch[1]) : 0;

        const listingType = source.type === 'sheriff-sale' ? 'sheriff-sale'
          : source.type === 'tax-sale' ? 'tax-lien'
          : 'foreclosure';

        items.push({
          title: `${source.county} County ${listingType}: ${address}`,
          address: `${address}, ${source.county}, ${source.state}`,
          city: source.county,
          state: source.state,
          zip: extractZip(address),
          county: source.county,
          price,
          original_price: null,
          starting_bid: price > 0 ? price : null,
          assessed_value: null,
          bedrooms: null,
          bathrooms: null,
          sqft: null,
          lot_size: null,
          year_built: null,
          property_type: 'single-family',
          listing_type: listingType,
          listing_category: 'county_public',
          source: `county-${source.type}`,
          source_url: source.url,
          image_urls: [],
          description: `${source.county} County ${source.type.replace(/-/g, ' ')} — public record`,
          auction_date: dateMatch ? dateMatch[1] : null,
          case_number: caseMatch ? caseMatch[1] : null,
          parcel_id: parcelMatch ? parcelMatch[1] : null,
          property_status: 'upcoming',
          lat: null,
          lng: null,
        });
      });
    }

    // Strategy 3: PDF link detection — log for manual processing
    if (items.length === 0) {
      const pdfLinks = $('a[href*=".pdf"]').filter((_, el) => {
        const text = $(el).text().toLowerCase();
        return /sale|foreclosure|auction|tax|sheriff|property/.test(text);
      });

      if (pdfLinks.length > 0) {
        console.log(`[Homes][County] ${source.county}, ${source.state}: Found ${pdfLinks.length} PDF links (need PDF parser for these)`);
        // Future: download and parse PDFs with pdf-parse or similar
      }
    }
  } catch (err: any) {
    // Don't error-spam for county sites — many will 403 or timeout
    if (err.response?.status !== 403 && err.code !== 'ECONNABORTED') {
      console.warn(`[Homes][County] ${source.county}, ${source.state} (${source.type}): ${err.message}`);
    }
  }

  return items;
}

// ============================================================
//  COUNTY SOURCES ORCHESTRATOR
// ============================================================

export async function scrapeCountySources(
  states: string[],
  isTimedOut: () => boolean
): Promise<CheapHomeItem[]> {
  const allItems: CheapHomeItem[] = [];

  // Filter sources to only include states we're processing
  const stateSet = new Set(states);
  const activeSources = COUNTY_SOURCES.filter(s => stateSet.has(s.state));

  // Check if county sources are enabled
  if (!isSourceEnabled('county-sheriff') && !isSourceEnabled('county-tax') && !isSourceEnabled('county-foreclosure')) {
    console.log('[Homes][County] All county sources disabled, skipping');
    return allItems;
  }

  console.log(`[Homes][County] Processing ${activeSources.length} county sources across ${new Set(activeSources.map(s => s.state)).size} states`);

  let processed = 0;
  let found = 0;

  // Process counties in batches of 5 (parallel within batch)
  const batchSize = 5;
  for (let i = 0; i < activeSources.length; i += batchSize) {
    if (isTimedOut()) {
      console.log(`[Homes][County] Timeout after ${processed}/${activeSources.length} counties`);
      break;
    }

    const batch = activeSources.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(source => {
        // Check if this specific source type is enabled
        if (source.type === 'sheriff-sale' && !isSourceEnabled('county-sheriff')) return Promise.resolve([]);
        if (source.type === 'tax-sale' && !isSourceEnabled('county-tax')) return Promise.resolve([]);
        if (source.type === 'foreclosure-notice' && !isSourceEnabled('county-foreclosure')) return Promise.resolve([]);
        return scrapeCountyPage(source);
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allItems.push(...result.value);
        found += result.value.length;
      }
    }

    processed += batch.length;
  }

  console.log(`[Homes][County] ${processed}/${activeSources.length} counties | ${found} items found`);
  return allItems;
}
