'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Home, MapPin, DollarSign, Search, RefreshCw, ExternalLink, BedDouble, Bath, Ruler } from 'lucide-react';

interface CheapHome {
  id: string;
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
  listing_type: string; // foreclosure, auction, short-sale, cheap
  source: string;
  source_url: string;
  photo_urls: string[]
  lat: number | null;
  lng: number | null;
  scraped_at: string;
  pushed: boolean;
}

export default function CheapHomesPage() {
  const [homes, setHomes] = useState<CheapHome[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [maxPrice, setMaxPrice] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchHomes();
  }, [page, stateFilter, typeFilter]);

  async function fetchHomes() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '30',
        ...(stateFilter !== 'all' && { state: stateFilter }),
        ...(typeFilter !== 'all' && { type: typeFilter }),
        ...(maxPrice && { max_price: maxPrice }),
        ...(searchQuery && { q: searchQuery }),
      });
      const res = await fetch(`/api/data/cheap-homes?${params}`);
      if (res.ok) {
        const data = await res.json();
        setHomes(data.items || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch homes:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatPrice(price: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(price);
  }

  function getDiscount(price: number, original: number | null) {
    if (!original || original <= price) return null;
    return Math.round(((original - price) / original) * 100);
  }

  const LISTING_TYPES = ['foreclosure', 'auction', 'short-sale', 'cheap', 'tax-lien'];
  const US_STATES = [
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY'
  ];

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl tracking-wider text-glow-cyan flex items-center gap-3">
          <Home className="w-6 h-6 text-matrix-cyan" />
          CHEAP HOMES PIPELINE
        </h1>
        <p className="text-matrix-green-dim/50 terminal-sm mt-1">
          Feeding CheapHouseHub.com | {totalCount.toLocaleString()} listings tracked
        </p>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-matrix-green-dim/40" />
          <input
            type="text"
            placeholder="Search homes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchHomes()}
            className="bg-transparent border-b border-matrix-panel-border text-matrix-green terminal-sm w-full outline-none focus:border-matrix-cyan transition-colors placeholder:text-matrix-green-dim/20"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setPage(1); }}
          className="bg-matrix-dark border border-matrix-panel-border text-matrix-green terminal-sm px-3 py-1 rounded outline-none"
        >
          <option value="all">All States</option>
          {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          className="bg-matrix-dark border border-matrix-panel-border text-matrix-cyan terminal-sm px-3 py-1 rounded outline-none"
        >
          <option value="all">All Types</option>
          {LISTING_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
        </select>
        <input
          type="number"
          placeholder="Max $"
          value={maxPrice}
          onChange={(e) => setMaxPrice(e.target.value)}
          className="bg-matrix-dark border border-matrix-panel-border text-matrix-amber terminal-sm px-3 py-1 rounded outline-none w-24"
        />
        <button onClick={fetchHomes} className="neon-btn-cyan text-[10px] px-3 py-1 flex items-center gap-1 border rounded">
          <RefreshCw className="w-3 h-3" /> REFRESH
        </button>
      </div>

      {/* Homes Grid */}
      {loading ? (
        <div className="text-center py-20">
          <RefreshCw className="w-8 h-8 text-matrix-cyan animate-spin mx-auto mb-4" />
          <p className="text-matrix-green-dim/50 terminal-sm">Scanning property data...</p>
        </div>
      ) : homes.length === 0 ? (
        <div className="text-center py-20 glass-panel">
          <Home className="w-12 h-12 text-matrix-green-dim/20 mx-auto mb-4" />
          <p className="text-matrix-green-dim/40 terminal-sm">No homes found. Run the scraper from the Dashboard.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {homes.map((home, i) => {
            const discount = getDiscount(home.price, home.original_price);
            return (
              <motion.div
                key={home.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="glass-panel overflow-hidden hover:scale-[1.01] transition-transform"
              >
                {/* Image placeholder */}
                {home.image_urls?.[0] ? (
                  <div className="h-40 bg-matrix-dark overflow-hidden">
                    <img src={home.image_urls[0]} alt={home.title} className="w-full h-full object-cover opacity-70" />
                  </div>
                ) : (
                  <div className="h-32 bg-matrix-dark flex items-center justify-center">
                    <Home className="w-10 h-10 text-matrix-green-dim/10" />
                  </div>
                )}

                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-matrix-cyan font-bold text-lg">{formatPrice(home.price)}</p>
                      {discount && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-matrix-green/10 text-matrix-green rounded">
                          {discount}% OFF
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] px-1.5 py-0.5 border border-matrix-cyan/30 text-matrix-cyan rounded uppercase">
                      {home.listing_type}
                    </span>
                  </div>

                  <h3 className="text-matrix-green terminal-sm font-bold line-clamp-1 mb-2">{home.title}</h3>

                  <div className="flex items-center gap-1.5 text-matrix-green-dim/50 terminal-xs mb-2">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="line-clamp-1">{home.address}, {home.city}, {home.state}</span>
                  </div>

                  <div className="flex items-center gap-4 text-matrix-green-dim/40 terminal-xs mb-3">
                    {home.bedrooms && (
                      <span className="flex items-center gap-1"><BedDouble className="w-3 h-3" />{home.bedrooms} bd</span>
                    )}
                    {home.bathrooms && (
                      <span className="flex items-center gap-1"><Bath className="w-3 h-3" />{home.bathrooms} ba</span>
                    )}
                    {home.sqft && (
                      <span className="flex items-center gap-1"><Ruler className="w-3 h-3" />{home.sqft.toLocaleString()} sqft</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="terminal-xs text-matrix-green-dim/20">{home.source}</span>
                    {home.source_url && (
                      <a href={home.source_url} target="_blank" rel="noopener noreferrer"
                         className="neon-btn-cyan text-[9px] px-2 py-0.5 border rounded flex items-center gap-1">
                        VIEW <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalCount > 30 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                  className="neon-btn-cyan text-[10px] px-4 py-1 border rounded disabled:opacity-30">PREV</button>
          <span className="terminal-xs text-matrix-green-dim/40">Page {page} of {Math.ceil(totalCount / 30)}</span>
          <button onClick={() => setPage((p) => p + 1)} disabled={page >= Math.ceil(totalCount / 30)}
                  className="neon-btn-cyan text-[10px] px-4 py-1 border rounded disabled:opacity-30">NEXT</button>
        </div>
      )}
    </div>
  );
}
