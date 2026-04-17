-- ============================================================
--  CITYSCRAPER.ORG — COMPLETE SUPABASE SQL SCHEMA
--  Run this ENTIRE script in your Supabase SQL Editor
--  Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================

-- ========================
--  1. EXTENSIONS
-- ========================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy text search


-- ========================
--  2. YARD SALES TABLE
-- ========================

CREATE TABLE IF NOT EXISTS yard_sales (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state VARCHAR(2) DEFAULT '',
  zip VARCHAR(10) DEFAULT '',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  date_start DATE,
  date_end DATE,
  price_range TEXT,
  categories TEXT[] DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] DEFAULT '{}',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  pushed BOOLEAN DEFAULT FALSE,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_url)
);

-- Indexes for yard_sales
CREATE INDEX IF NOT EXISTS idx_yard_sales_state ON yard_sales(state);
CREATE INDEX IF NOT EXISTS idx_yard_sales_city ON yard_sales(city);
CREATE INDEX IF NOT EXISTS idx_yard_sales_date ON yard_sales(date_start DESC);
CREATE INDEX IF NOT EXISTS idx_yard_sales_pushed ON yard_sales(pushed);
CREATE INDEX IF NOT EXISTS idx_yard_sales_source ON yard_sales(source);
CREATE INDEX IF NOT EXISTS idx_yard_sales_title_trgm ON yard_sales USING gin(title gin_trgm_ops);


-- ========================
--  3. CHEAP HOMES TABLE
-- ========================

CREATE TABLE IF NOT EXISTS cheap_homes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state VARCHAR(2) DEFAULT '',
  zip VARCHAR(10) DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  original_price NUMERIC(12,2),
  bedrooms INTEGER,
  bathrooms NUMERIC(3,1),
  sqft INTEGER,
  lot_size TEXT,
  property_type TEXT DEFAULT 'single-family',
  listing_type TEXT DEFAULT 'cheap',  -- foreclosure, auction, short-sale, tax-lien, cheap
  source TEXT NOT NULL DEFAULT 'unknown',
  source_url TEXT NOT NULL DEFAULT '',
  image_urls TEXT[] DEFAULT '{}',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  pushed BOOLEAN DEFAULT FALSE,
  pushed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_url)
);

-- Indexes for cheap_homes
CREATE INDEX IF NOT EXISTS idx_cheap_homes_state ON cheap_homes(state);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_price ON cheap_homes(price ASC);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_type ON cheap_homes(listing_type);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_pushed ON cheap_homes(pushed);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_city ON cheap_homes(city);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_beds ON cheap_homes(bedrooms);
CREATE INDEX IF NOT EXISTS idx_cheap_homes_address_trgm ON cheap_homes USING gin(address gin_trgm_ops);


-- ========================
--  4. CRYPTO ASSETS TABLE
-- ========================

CREATE TABLE IF NOT EXISTS crypto_assets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  coin_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  price_usd NUMERIC(20,8) DEFAULT 0,
  change_24h NUMERIC(10,4) DEFAULT 0,
  change_7d NUMERIC(10,4) DEFAULT 0,
  change_30d NUMERIC(10,4) DEFAULT 0,
  market_cap NUMERIC(20,2) DEFAULT 0,
  volume_24h NUMERIC(20,2) DEFAULT 0,
  circulating_supply NUMERIC(20,2) DEFAULT 0,
  total_supply NUMERIC(20,2),
  ath NUMERIC(20,8) DEFAULT 0,
  ath_change_pct NUMERIC(10,4) DEFAULT 0,
  rank INTEGER DEFAULT 0,
  image_url TEXT,
  source TEXT NOT NULL DEFAULT 'coingecko',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coin_id, source)
);

CREATE INDEX IF NOT EXISTS idx_crypto_assets_rank ON crypto_assets(rank ASC);
CREATE INDEX IF NOT EXISTS idx_crypto_assets_symbol ON crypto_assets(symbol);
CREATE INDEX IF NOT EXISTS idx_crypto_assets_source ON crypto_assets(source);


-- ========================
--  5. CRYPTO NEWS TABLE
-- ========================

CREATE TABLE IF NOT EXISTS crypto_news (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  source TEXT DEFAULT 'unknown',
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  sentiment TEXT DEFAULT 'neutral',  -- positive, negative, neutral
  related_coins TEXT[] DEFAULT '{}',
  image_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(url)
);

CREATE INDEX IF NOT EXISTS idx_crypto_news_published ON crypto_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_crypto_news_sentiment ON crypto_news(sentiment);


-- ========================
--  6. DEFI YIELDS TABLE
-- ========================

CREATE TABLE IF NOT EXISTS defi_yields (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  protocol TEXT NOT NULL,
  pool TEXT NOT NULL,
  chain TEXT DEFAULT 'unknown',
  apy NUMERIC(10,4) DEFAULT 0,
  apy_base NUMERIC(10,4) DEFAULT 0,
  apy_reward NUMERIC(10,4) DEFAULT 0,
  tvl NUMERIC(20,2) DEFAULT 0,
  risk_level TEXT DEFAULT 'medium',  -- low, medium, high
  stable_coin BOOLEAN DEFAULT FALSE,
  il_risk BOOLEAN DEFAULT FALSE,
  pool_id TEXT NOT NULL DEFAULT '',
  source TEXT DEFAULT 'defillama',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pool_id)
);

CREATE INDEX IF NOT EXISTS idx_defi_yields_apy ON defi_yields(apy DESC);
CREATE INDEX IF NOT EXISTS idx_defi_yields_tvl ON defi_yields(tvl DESC);
CREATE INDEX IF NOT EXISTS idx_defi_yields_chain ON defi_yields(chain);
CREATE INDEX IF NOT EXISTS idx_defi_yields_risk ON defi_yields(risk_level);


-- ========================
--  7. CRYPTO SENTIMENT TABLE
-- ========================

CREATE TABLE IF NOT EXISTS crypto_sentiment (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  type TEXT NOT NULL,  -- fear_greed, social, etc.
  data JSONB DEFAULT '{}',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(type)
);


-- ========================
--  8. CRYPTO TRENDING TABLE
-- ========================

CREATE TABLE IF NOT EXISTS crypto_trending (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  coin_id TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  rank INTEGER,
  price_btc NUMERIC(20,12),
  image_url TEXT,
  source TEXT DEFAULT 'coingecko-trending',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coin_id)
);


-- ========================
--  9. CRYPTO GLOBAL MARKET TABLE
-- ========================

CREATE TABLE IF NOT EXISTS crypto_global (
  id TEXT PRIMARY KEY DEFAULT 'latest',
  total_market_cap NUMERIC(20,2) DEFAULT 0,
  total_volume NUMERIC(20,2) DEFAULT 0,
  btc_dominance NUMERIC(6,2) DEFAULT 0,
  eth_dominance NUMERIC(6,2) DEFAULT 0,
  active_cryptocurrencies INTEGER DEFAULT 0,
  markets INTEGER DEFAULT 0,
  market_cap_change_24h NUMERIC(10,4) DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);


-- ========================
--  10. SCRAPE LOGS TABLE
-- ========================

CREATE TABLE IF NOT EXISTS scrape_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pipeline TEXT NOT NULL,  -- yard-sales, cheap-homes, crypto
  status TEXT NOT NULL DEFAULT 'running',  -- running, success, error
  items_found INTEGER DEFAULT 0,
  items_pushed INTEGER DEFAULT 0,
  errors INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scrape_logs_pipeline ON scrape_logs(pipeline);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_started ON scrape_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_status ON scrape_logs(status);


-- ========================
--  11. AUTO-UPDATE TIMESTAMPS
-- ========================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_yard_sales_updated_at
  BEFORE UPDATE ON yard_sales
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cheap_homes_updated_at
  BEFORE UPDATE ON cheap_homes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_crypto_assets_updated_at
  BEFORE UPDATE ON crypto_assets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- ========================
--  12. ROW LEVEL SECURITY
-- ========================

-- Enable RLS on all tables
ALTER TABLE yard_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE cheap_homes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE defi_yields ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_trending ENABLE ROW LEVEL SECURITY;
ALTER TABLE crypto_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_logs ENABLE ROW LEVEL SECURITY;

-- Public read access (dashboard reads via anon key)
CREATE POLICY "Public read yard_sales" ON yard_sales FOR SELECT USING (true);
CREATE POLICY "Public read cheap_homes" ON cheap_homes FOR SELECT USING (true);
CREATE POLICY "Public read crypto_assets" ON crypto_assets FOR SELECT USING (true);
CREATE POLICY "Public read crypto_news" ON crypto_news FOR SELECT USING (true);
CREATE POLICY "Public read defi_yields" ON defi_yields FOR SELECT USING (true);
CREATE POLICY "Public read crypto_sentiment" ON crypto_sentiment FOR SELECT USING (true);
CREATE POLICY "Public read crypto_trending" ON crypto_trending FOR SELECT USING (true);
CREATE POLICY "Public read crypto_global" ON crypto_global FOR SELECT USING (true);
CREATE POLICY "Public read scrape_logs" ON scrape_logs FOR SELECT USING (true);

-- Service role has full access (handled by supabaseAdmin client bypassing RLS)
-- No additional write policies needed for anon key — scrapers use service role


-- ========================
--  13. USEFUL VIEWS
-- ========================

-- Dashboard summary view
CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
  (SELECT COUNT(*) FROM yard_sales) AS total_yard_sales,
  (SELECT COUNT(*) FROM yard_sales WHERE pushed = true) AS pushed_yard_sales,
  (SELECT COUNT(*) FROM cheap_homes) AS total_cheap_homes,
  (SELECT COUNT(*) FROM cheap_homes WHERE pushed = true) AS pushed_cheap_homes,
  (SELECT COUNT(*) FROM crypto_assets) AS total_crypto_assets,
  (SELECT COUNT(*) FROM crypto_news) AS total_crypto_news,
  (SELECT COUNT(*) FROM defi_yields) AS total_defi_yields;

-- Recent scrapes view
CREATE OR REPLACE VIEW recent_scrapes AS
SELECT * FROM scrape_logs
ORDER BY started_at DESC
LIMIT 50;


-- ========================
--  DONE! Schema ready.
-- ========================
