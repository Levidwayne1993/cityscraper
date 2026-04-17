import axios from 'axios';
import { supabaseAdmin } from '@/lib/supabase';

// ============================================================
//  CRYPTO SCRAPER — Powers CryptoToolbox.org
//  Sources: CoinGecko, CoinMarketCap, Messari, DeFiLlama,
//           CryptoCompare News, Fear & Greed Index
//  Collects: prices, market data, news, DeFi yields, sentiment
// ============================================================

// ---------- COINGECKO (Free tier: 30 calls/min) ----------

async function fetchCoinGeckoPrices(): Promise<any[]> {
  const items: any[] = [];

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: {
        vs_currency: 'usd',
        order: 'market_cap_desc',
        per_page: 250,
        page: 1,
        sparkline: false,
        price_change_percentage: '24h,7d,30d',
      },
      headers: {
        Accept: 'application/json',
        ...(process.env.COINGECKO_API_KEY && {
          'x-cg-demo-api-key': process.env.COINGECKO_API_KEY,
        }),
      },
      timeout: 15000,
    });

    if (Array.isArray(response.data)) {
      for (const coin of response.data) {
        items.push({
          coin_id: coin.id,
          symbol: coin.symbol,
          name: coin.name,
          price_usd: coin.current_price || 0,
          change_24h: coin.price_change_percentage_24h || 0,
          change_7d: coin.price_change_percentage_7d_in_currency || 0,
          change_30d: coin.price_change_percentage_30d_in_currency || 0,
          market_cap: coin.market_cap || 0,
          volume_24h: coin.total_volume || 0,
          circulating_supply: coin.circulating_supply || 0,
          total_supply: coin.total_supply || null,
          ath: coin.ath || 0,
          ath_change_pct: coin.ath_change_percentage || 0,
          rank: coin.market_cap_rank || 0,
          image_url: coin.image || null,
          source: 'coingecko',
          scraped_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Crypto] CoinGecko: ${items.length} assets fetched`);
  } catch (err: any) {
    console.error(`[Crypto] CoinGecko error: ${err.message}`);
  }

  return items;
}

// ---------- COINMARKETCAP (Free tier: 333 calls/day) ----------

async function fetchCoinMarketCapPrices(): Promise<any[]> {
  const items: any[] = [];
  const apiKey = process.env.COINMARKETCAP_API_KEY;

  if (!apiKey) {
    console.warn('[Crypto] COINMARKETCAP_API_KEY not set, skipping');
    return items;
  }

  try {
    const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', {
      params: {
        limit: 200,
        convert: 'USD',
        sort: 'market_cap',
      },
      headers: {
        'X-CMC_PRO_API_KEY': apiKey,
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    if (response.data?.data) {
      for (const coin of response.data.data) {
        const quote = coin.quote?.USD;
        if (!quote) continue;

        items.push({
          coin_id: coin.slug,
          symbol: coin.symbol.toLowerCase(),
          name: coin.name,
          price_usd: quote.price || 0,
          change_24h: quote.percent_change_24h || 0,
          change_7d: quote.percent_change_7d || 0,
          change_30d: quote.percent_change_30d || 0,
          market_cap: quote.market_cap || 0,
          volume_24h: quote.volume_24h || 0,
          circulating_supply: coin.circulating_supply || 0,
          total_supply: coin.total_supply || null,
          rank: coin.cmc_rank || 0,
          image_url: `https://s2.coinmarketcap.com/static/img/coins/64x64/${coin.id}.png`,
          source: 'coinmarketcap',
          scraped_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Crypto] CoinMarketCap: ${items.length} assets fetched`);
  } catch (err: any) {
    console.error(`[Crypto] CoinMarketCap error: ${err.message}`);
  }

  return items;
}

// ---------- CRYPTO NEWS (CryptoCompare) ----------

async function fetchCryptoNews(): Promise<any[]> {
  const items: any[] = [];

  try {
    const response = await axios.get('https://min-api.cryptocompare.com/data/v2/news/', {
      params: { lang: 'EN', sortOrder: 'latest' },
      timeout: 15000,
    });

    if (response.data?.Data) {
      for (const article of response.data.Data.slice(0, 50)) {
        items.push({
          title: article.title,
          summary: (article.body || '').substring(0, 500),
          source: article.source_info?.name || article.source || 'Unknown',
          url: article.url || article.guid || '',
          published_at: new Date(article.published_on * 1000).toISOString(),
          sentiment: detectSentiment(article.title + ' ' + (article.body || '')),
          related_coins: extractCoins(article.categories || ''),
          image_url: article.imageurl || null,
          scraped_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Crypto] News: ${items.length} articles fetched`);
  } catch (err: any) {
    console.error(`[Crypto] News error: ${err.message}`);
  }

  return items;
}

// ---------- DEFI YIELDS (DeFiLlama — free, no key needed) ----------

async function fetchDeFiYields(): Promise<any[]> {
  const items: any[] = [];

  try {
    const response = await axios.get('https://yields.llama.fi/pools', {
      timeout: 20000,
    });

    if (Array.isArray(response.data?.data)) {
      // Filter for top yields with decent TVL
      const pools = response.data.data
        .filter((p: any) => p.tvlUsd > 100000 && p.apy > 1 && p.apy < 500)
        .sort((a: any, b: any) => b.tvlUsd - a.tvlUsd)
        .slice(0, 200);

      for (const pool of pools) {
        items.push({
          protocol: pool.project || 'Unknown',
          pool: pool.symbol || pool.pool || 'Unknown',
          chain: pool.chain || 'Unknown',
          apy: pool.apy || 0,
          apy_base: pool.apyBase || 0,
          apy_reward: pool.apyReward || 0,
          tvl: pool.tvlUsd || 0,
          risk_level: assessRisk(pool),
          stable_coin: pool.stablecoin || false,
          il_risk: pool.ilRisk === 'yes' ? true : false,
          pool_id: pool.pool || '',
          source: 'defillama',
          scraped_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Crypto] DeFi yields: ${items.length} pools fetched`);
  } catch (err: any) {
    console.error(`[Crypto] DeFi error: ${err.message}`);
  }

  return items;
}

// ---------- FEAR & GREED INDEX ----------

async function fetchFearGreedIndex(): Promise<any> {
  try {
    const response = await axios.get('https://api.alternative.me/fng/', {
      params: { limit: 30 },
      timeout: 10000,
    });

    if (response.data?.data) {
      return {
        current: response.data.data[0],
        history: response.data.data,
        scraped_at: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    console.error(`[Crypto] Fear & Greed error: ${err.message}`);
  }
  return null;
}

// ---------- TRENDING COINS (CoinGecko) ----------

async function fetchTrending(): Promise<any[]> {
  const items: any[] = [];

  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/search/trending', {
      headers: {
        Accept: 'application/json',
        ...(process.env.COINGECKO_API_KEY && {
          'x-cg-demo-api-key': process.env.COINGECKO_API_KEY,
        }),
      },
      timeout: 10000,
    });

    if (response.data?.coins) {
      for (const coin of response.data.coins) {
        items.push({
          coin_id: coin.item?.id,
          symbol: coin.item?.symbol,
          name: coin.item?.name,
          rank: coin.item?.market_cap_rank,
          price_btc: coin.item?.price_btc,
          image_url: coin.item?.thumb,
          source: 'coingecko-trending',
          scraped_at: new Date().toISOString(),
        });
      }
    }

    console.log(`[Crypto] Trending: ${items.length} coins`);
  } catch (err: any) {
    console.error(`[Crypto] Trending error: ${err.message}`);
  }

  return items;
}

// ---------- GLOBAL MARKET DATA ----------

async function fetchGlobalData(): Promise<any> {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/global', {
      timeout: 10000,
    });

    if (response.data?.data) {
      const d = response.data.data;
      return {
        total_market_cap: d.total_market_cap?.usd || 0,
        total_volume: d.total_volume?.usd || 0,
        btc_dominance: d.market_cap_percentage?.btc || 0,
        eth_dominance: d.market_cap_percentage?.eth || 0,
        active_cryptocurrencies: d.active_cryptocurrencies || 0,
        markets: d.markets || 0,
        market_cap_change_24h: d.market_cap_change_percentage_24h_usd || 0,
        scraped_at: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    console.error(`[Crypto] Global data error: ${err.message}`);
  }
  return null;
}

// ---------- MAIN SCRAPE FUNCTION ----------

export async function scrapeCrypto(): Promise<{
  success: boolean;
  itemsFound: number;
  errors: number;
  details: string;
}> {
  console.log('[Crypto] Starting full scrape...');
  const startTime = Date.now();
  let totalItems = 0;
  let totalErrors = 0;

  // 1. Fetch prices from CoinGecko (primary)
  const cgPrices = await fetchCoinGeckoPrices();
  if (cgPrices.length > 0) {
    const { error } = await supabaseAdmin
      .from('crypto_assets')
      .upsert(cgPrices, { onConflict: 'coin_id,source' });
    if (error) { totalErrors++; console.error('[Crypto] Price upsert error:', error); }
    else totalItems += cgPrices.length;
  }

  // 2. Fetch CMC prices (supplemental)
  const cmcPrices = await fetchCoinMarketCapPrices();
  if (cmcPrices.length > 0) {
    const { error } = await supabaseAdmin
      .from('crypto_assets')
      .upsert(cmcPrices, { onConflict: 'coin_id,source' });
    if (error) { totalErrors++; console.error('[Crypto] CMC upsert error:', error); }
    else totalItems += cmcPrices.length;
  }

  // 3. Fetch news
  const newsItems = await fetchCryptoNews();
  if (newsItems.length > 0) {
    const { error } = await supabaseAdmin
      .from('crypto_news')
      .upsert(newsItems, { onConflict: 'url' });
    if (error) { totalErrors++; console.error('[Crypto] News upsert error:', error); }
    else totalItems += newsItems.length;
  }

  // 4. Fetch DeFi yields
  const defiYields = await fetchDeFiYields();
  if (defiYields.length > 0) {
    const { error } = await supabaseAdmin
      .from('defi_yields')
      .upsert(defiYields, { onConflict: 'pool_id' });
    if (error) { totalErrors++; console.error('[Crypto] DeFi upsert error:', error); }
    else totalItems += defiYields.length;
  }

  // 5. Fetch Fear & Greed Index
  const fng = await fetchFearGreedIndex();
  if (fng) {
    const { error } = await supabaseAdmin
      .from('crypto_sentiment')
      .upsert({ type: 'fear_greed', data: fng, scraped_at: new Date().toISOString() }, { onConflict: 'type' });
    if (error) totalErrors++;
    else totalItems++;
  }

  // 6. Fetch trending coins
  const trending = await fetchTrending();
  if (trending.length > 0) {
    const { error } = await supabaseAdmin
      .from('crypto_trending')
      .upsert(trending.map((t) => ({ ...t })), { onConflict: 'coin_id' });
    if (error) totalErrors++;
    else totalItems += trending.length;
  }

  // 7. Fetch global market data
  const globalData = await fetchGlobalData();
  if (globalData) {
    const { error } = await supabaseAdmin
      .from('crypto_global')
      .upsert({ id: 'latest', ...globalData }, { onConflict: 'id' });
    if (error) totalErrors++;
    else totalItems++;
  }

  const duration = Date.now() - startTime;
  console.log(`[Crypto] Scrape complete: ${totalItems} items, ${totalErrors} errors, ${duration}ms`);

  return {
    success: totalErrors === 0,
    itemsFound: totalItems,
    errors: totalErrors,
    details: `Fetched ${totalItems} crypto data points in ${(duration / 1000).toFixed(1)}s`,
  };
}

// ---------- UTILITIES ----------

function detectSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const lower = text.toLowerCase();
  const bullish = ['surge', 'rally', 'bullish', 'soar', 'gain', 'rise', 'breakout', 'ath', 'record', 'pump', 'adoption', 'partnership', 'launch'];
  const bearish = ['crash', 'dump', 'bearish', 'plunge', 'drop', 'fall', 'hack', 'scam', 'fraud', 'ban', 'regulation', 'lawsuit', 'sec'];

  const bullScore = bullish.filter((w) => lower.includes(w)).length;
  const bearScore = bearish.filter((w) => lower.includes(w)).length;

  if (bullScore > bearScore) return 'positive';
  if (bearScore > bullScore) return 'negative';
  return 'neutral';
}

function extractCoins(categories: string): string[] {
  const known = ['BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK', 'UNI', 'AAVE', 'XRP', 'DOGE', 'SHIB', 'BNB', 'LTC'];
  const upper = categories.toUpperCase();
  return known.filter((c) => upper.includes(c));
}

function assessRisk(pool: any): 'low' | 'medium' | 'high' {
  if (pool.stablecoin && pool.tvlUsd > 10000000) return 'low';
  if (pool.tvlUsd > 1000000 && pool.apy < 20) return 'low';
  if (pool.tvlUsd > 100000 && pool.apy < 50) return 'medium';
  return 'high';
}
