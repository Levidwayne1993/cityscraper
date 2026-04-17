import axios from 'axios';
import * as cheerio from 'cheerio';
import { supabaseAdmin } from '@/lib/supabase';
import PQueue from 'p-queue';

// ============================================================
//  CHEAP HOME SCRAPER — Powers CheapHouseHub.com
//  Sources: HUD HomeStore, Foreclosure.com listings, RealtyMole API,
//           RentCast API, public auction listings
//  Collects: address, price, beds/baths/sqft, listing type, images
// ============================================================

export interface CheapHomeItem {
  title: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  price: number;
  original_price: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  lot_size: string | null;
  property_type: string;
  listing_type: string;
  source: string;
  source_url: string;
  image_urls: string[];
  lat: number | null;
  lng: number | null;
}

const queue = new PQueue({ concurrency: 2, interval: 1500, intervalCap: 2 });

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Target states for scraping
const TARGET_STATES = [
  'WA', 'OR', 'CA', 'TX', 'FL', 'NY', 'IL', 'PA', 'OH', 'GA',
  'NC', 'MI', 'AZ', 'CO', 'TN', 'IN', 'MO', 'WI', 'MN', 'AL',
  'SC', 'LA', 'KY', 'OK', 'NV', 'NM', 'MS', 'AR', 'KS', 'NE',
  'WV', 'ID', 'HI', 'ME', 'MT', 'ND', 'SD', 'VT', 'WY', 'DE',
  'NH', 'RI', 'CT', 'NJ', 'MD', 'VA', 'MA', 'IA', 'UT',
];

// ---------- HUD HOMESTORE SCRAPER (Government foreclosures) ----------

async function scrapeHUDHomes(state: string): Promise<CheapHomeItem[]> {
  const items: CheapHomeItem[] = [];

  try {
    // HUD HomeStore API endpoint
    const url = `https://www.hudhomestore.gov/Listing/PropertySearchResult`;
    const response = await axios.get(url, {
      params: {
        sState: state,
        iPageSize: 50,
        sOrderBy: 'DLISTPRICE',
        sOrderByDirection: 'ASC',
      },
      headers: { 'User-Agent': getRandomUA() },
      timeout: 20000,
    });

    const $ = cheerio.load(response.data);

    $('.resultsPropertyRow, .property-card, .listing-result').each((_, el) => {
      const address = $(el).find('.address, .prop-address').text().trim();
      const priceText = $(el).find('.price, .list-price').text().trim();
      const bedsText = $(el).find('.beds, .bedrooms').text().trim();
      const bathsText = $(el).find('.baths, .bathrooms').text().trim();
      const sqftText = $(el).find('.sqft, .square-feet').text().trim();
      const link = $(el).find('a').attr('href') || '';
      const imgSrc = $(el).find('img').attr('src') || '';
      const propType = $(el).find('.property-type, .type').text().trim();

      const price = parsePrice(priceText);
      if (price > 0 && address) {
        items.push({
          title: `HUD Home: ${address}`,
          address,
          city: extractCity(address),
          state,
          zip: extractZip(address),
          price,
          original_price: null,
          bedrooms: parseInt(bedsText) || null,
          bathrooms: parseFloat(bathsText) || null,
          sqft: parseInt(sqftText.replace(/[^0-9]/g, '')) || null,
          lot_size: null,
          property_type: propType || 'single-family',
          listing_type: 'foreclosure',
          source: 'hud-homestore',
          source_url: link.startsWith('http') ? link : `https://www.hudhomestore.gov${link}`,
          image_urls: imgSrc ? [imgSrc] : [],
          lat: null,
          lng: null,
        });
      }
    });
  } catch (err: any) {
    console.error(`[Homes] HUD ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- REALTYMOLE API SCRAPER ----------

async function scrapeRealtyMole(state: string): Promise<CheapHomeItem[]> {
  const items: CheapHomeItem[] = [];
  const apiKey = process.env.REALTY_MOLE_API_KEY;

  if (!apiKey) {
    console.warn('[Homes] REALTY_MOLE_API_KEY not set, skipping');
    return items;
  }

  try {
    // RealtyMole property search
    const response = await axios.get('https://realty-mole-property-api.p.rapidapi.com/saleListings', {
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
    });

    if (Array.isArray(response.data)) {
      for (const prop of response.data) {
        if (prop.price && prop.price < 150000) { // Only cheap homes
          items.push({
            title: `${prop.propertyType || 'Property'}: ${prop.addressLine1 || prop.formattedAddress}`,
            address: prop.formattedAddress || prop.addressLine1 || '',
            city: prop.city || '',
            state: prop.state || state,
            zip: prop.zipCode || '',
            price: prop.price,
            original_price: null,
            bedrooms: prop.bedrooms || null,
            bathrooms: prop.bathrooms || null,
            sqft: prop.squareFootage || null,
            lot_size: prop.lotSize ? `${prop.lotSize} sqft` : null,
            property_type: (prop.propertyType || 'single-family').toLowerCase(),
            listing_type: 'cheap',
            source: 'realtymole',
            source_url: prop.listingUrl || '',
            image_urls: prop.imageUrl ? [prop.imageUrl] : [],
            lat: prop.latitude || null,
            lng: prop.longitude || null,
          });
        }
      }
    }
  } catch (err: any) {
    console.error(`[Homes] RealtyMole ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- RENTCAST API SCRAPER ----------

async function scrapeRentCast(state: string): Promise<CheapHomeItem[]> {
  const items: CheapHomeItem[] = [];
  const apiKey = process.env.RENTCAST_API_KEY;

  if (!apiKey) {
    console.warn('[Homes] RENTCAST_API_KEY not set, skipping');
    return items;
  }

  try {
    const response = await axios.get('https://api.rentcast.io/v1/listings/sale', {
      params: {
        state,
        limit: 50,
        status: 'Active',
        maxPrice: 150000,
        orderBy: 'price',
      },
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    if (Array.isArray(response.data)) {
      for (const prop of response.data) {
        items.push({
          title: `${prop.propertyType || 'Property'}: ${prop.formattedAddress || prop.addressLine1}`,
          address: prop.formattedAddress || `${prop.addressLine1}, ${prop.city}, ${prop.state}`,
          city: prop.city || '',
          state: prop.state || state,
          zip: prop.zipCode || '',
          price: prop.price || 0,
          original_price: prop.previousPrice || null,
          bedrooms: prop.bedrooms || null,
          bathrooms: prop.bathrooms || null,
          sqft: prop.squareFootage || null,
          lot_size: prop.lotSize ? `${prop.lotSize} sqft` : null,
          property_type: (prop.propertyType || 'single-family').toLowerCase(),
          listing_type: detectListingType(prop),
          source: 'rentcast',
          source_url: prop.listingUrl || '',
          image_urls: prop.imageUrl ? [prop.imageUrl] : [],
          lat: prop.latitude || null,
          lng: prop.longitude || null,
        });
      }
    }
  } catch (err: any) {
    console.error(`[Homes] RentCast ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- PUBLIC AUCTION SCRAPER ----------

async function scrapeAuctions(state: string): Promise<CheapHomeItem[]> {
  const items: CheapHomeItem[] = [];

  try {
    const url = `https://www.auction.com/residential/${state.toLowerCase()}/`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': getRandomUA() },
      timeout: 20000,
    });

    const $ = cheerio.load(response.data);

    $('.property-card, .auction-listing, .result-card').each((_, el) => {
      const address = $(el).find('.address, .property-address').text().trim();
      const priceText = $(el).find('.price, .current-bid, .starting-bid').text().trim();
      const bedsText = $(el).find('.beds').text().trim();
      const bathsText = $(el).find('.baths').text().trim();
      const sqftText = $(el).find('.sqft').text().trim();
      const link = $(el).find('a').attr('href') || '';
      const imgSrc = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
      const auctionType = $(el).find('.auction-type, .sale-type').text().trim();

      const price = parsePrice(priceText);
      if (price > 0 && address) {
        items.push({
          title: `Auction: ${address}`,
          address,
          city: extractCity(address),
          state,
          zip: extractZip(address),
          price,
          original_price: null,
          bedrooms: parseInt(bedsText) || null,
          bathrooms: parseFloat(bathsText) || null,
          sqft: parseInt(sqftText.replace(/[^0-9]/g, '')) || null,
          lot_size: null,
          property_type: 'single-family',
          listing_type: auctionType.toLowerCase().includes('foreclosure') ? 'foreclosure' : 'auction',
          source: 'auction.com',
          source_url: link.startsWith('http') ? link : `https://www.auction.com${link}`,
          image_urls: imgSrc ? [imgSrc] : [],
          lat: null,
          lng: null,
        });
      }
    });
  } catch (err: any) {
    console.error(`[Homes] Auction.com ${state} error: ${err.message}`);
  }

  return items;
}

// ---------- MAIN SCRAPE FUNCTION ----------

export async function scrapeCheapHomes(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  console.log('[Homes] Starting full scrape...');
  const startTime = Date.now();
  let totalItems = 0;
  let totalErrors = 0;
  const allItems: CheapHomeItem[] = [];

  for (const state of TARGET_STATES) {
    // HUD Homes (always free, government data)
    const hudItems = await queue.add(() => scrapeHUDHomes(state));
    if (hudItems) allItems.push(...hudItems);

    // API-based scrapers (if keys configured)
    const rmItems = await queue.add(() => scrapeRealtyMole(state));
    if (rmItems) allItems.push(...rmItems);

    const rcItems = await queue.add(() => scrapeRentCast(state));
    if (rcItems) allItems.push(...rcItems);

    // Auction scraper
    const auctionItems = await queue.add(() => scrapeAuctions(state));
    if (auctionItems) allItems.push(...auctionItems);
  }

  // Deduplicate by address
  const seen = new Set<string>();
  const uniqueItems = allItems.filter((item) => {
    const key = `${item.address.toLowerCase().replace(/\s+/g, '')}-${item.zip}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Upsert to Supabase
  if (uniqueItems.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < uniqueItems.length; i += batchSize) {
      const batch = uniqueItems.slice(i, i + batchSize).map((item) => ({
        ...item,
        scraped_at: new Date().toISOString(),
        pushed: false,
      }));

      const { error } = await supabaseAdmin
        .from('cheap_homes')
        .upsert(batch, { onConflict: 'source_url' });

      if (error) {
        console.error(`[Homes] Upsert batch error:`, error);
        totalErrors++;
      } else {
        totalItems += batch.length;
      }
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[Homes] Scrape complete: ${totalItems} items, ${totalErrors} errors, ${duration}ms`);

  return {
    success: totalErrors === 0,
    itemsFound: totalItems,
    errors: totalErrors,
    details: `Scraped ${TARGET_STATES.length} states, ${totalItems} cheap homes in ${(duration / 1000).toFixed(1)}s`,
  };
}

// ---------- UTILITIES ----------

function parsePrice(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  return parseFloat(cleaned) || 0;
}

function extractCity(address: string): string {
  const parts = address.split(',').map((p) => p.trim());
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0] || 'Unknown';
}

function extractZip(address: string): string {
  const match = address.match(/\b\d{5}(-\d{4})?\b/);
  return match ? match[0] : '';
}

function detectListingType(prop: any): string {
  const status = (prop.status || '').toLowerCase();
  const desc = (prop.description || '').toLowerCase();
  if (status.includes('foreclos') || desc.includes('foreclos')) return 'foreclosure';
  if (status.includes('auction') || desc.includes('auction')) return 'auction';
  if (status.includes('short') || desc.includes('short sale')) return 'short-sale';
  if (desc.includes('tax lien') || desc.includes('tax deed')) return 'tax-lien';
  return 'cheap';
}
