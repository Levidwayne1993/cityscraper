'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Tag, MapPin, Calendar, DollarSign, Search, RefreshCw, ExternalLink } from 'lucide-react';

interface YardSale {
  id: string;
  title: string;
  description: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  date_start: string;
  date_end: string | null;
  price_range: string | null;
  categories: string[];
  source: string;
  source_url: string;
  image_urls: string[];
  scraped_at: string;
  pushed: boolean;
}

export default function YardSalesPage() {
  const [sales, setSales] = useState<YardSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchSales();
  }, [page, stateFilter]);

  async function fetchSales() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        ...(stateFilter !== 'all' && { state: stateFilter }),
        ...(searchQuery && { q: searchQuery }),
      });
      const res = await fetch(`/api/data/yard-sales?${params}`);
      if (res.ok) {
        const data = await res.json();
        setSales(data.items || []);
        setTotalCount(data.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch yard sales:', err);
    } finally {
      setLoading(false);
    }
  }

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
        <h1 className="font-display text-2xl tracking-wider text-glow flex items-center gap-3">
          <Tag className="w-6 h-6 text-matrix-green" />
          YARD SALES PIPELINE
        </h1>
        <p className="text-matrix-green-dim/50 terminal-sm mt-1">
          Feeding YardShoppers.com | {totalCount.toLocaleString()} sales tracked
        </p>
      </div>

      {/* Filters */}
      <div className="glass-panel p-4 mb-6 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-matrix-green-dim/40" />
          <input
            type="text"
            placeholder="Search sales..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchSales()}
            className="bg-transparent border-b border-matrix-panel-border text-matrix-green terminal-sm w-full outline-none focus:border-matrix-green transition-colors placeholder:text-matrix-green-dim/20"
          />
        </div>
        <select
          value={stateFilter}
          onChange={(e) => { setStateFilter(e.target.value); setPage(1); }}
          className="bg-matrix-dark border border-matrix-panel-border text-matrix-green terminal-sm px-3 py-1 rounded outline-none"
        >
          <option value="all">All States</option>
          {US_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={fetchSales} className="neon-btn text-[10px] px-3 py-1 flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> REFRESH
        </button>
      </div>

      {/* Sales Grid */}
      {loading ? (
        <div className="text-center py-20">
          <RefreshCw className="w-8 h-8 text-matrix-green animate-spin mx-auto mb-4" />
          <p className="text-matrix-green-dim/50 terminal-sm">Scanning yard sales data...</p>
        </div>
      ) : sales.length === 0 ? (
        <div className="text-center py-20 glass-panel">
          <Tag className="w-12 h-12 text-matrix-green-dim/20 mx-auto mb-4" />
          <p className="text-matrix-green-dim/40 terminal-sm">No yard sales found. Run the scraper from the Dashboard.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sales.map((sale, i) => (
            <motion.div
              key={sale.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className="glass-panel p-4 hover:scale-[1.01] transition-transform"
            >
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-matrix-green terminal-sm font-bold line-clamp-2">{sale.title}</h3>
                {sale.source_url && (
                  <a href={sale.source_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3 text-matrix-green-dim/30 hover:text-matrix-cyan flex-shrink-0 ml-2" />
                  </a>
                )}
              </div>

              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-1.5 text-matrix-green-dim/50 terminal-xs">
                  <MapPin className="w-3 h-3 flex-shrink-0" />
                  <span className="line-clamp-1">{sale.city}, {sale.state} {sale.zip}</span>
                </div>
                <div className="flex items-center gap-1.5 text-matrix-green-dim/50 terminal-xs">
                  <Calendar className="w-3 h-3 flex-shrink-0" />
                  <span>{new Date(sale.date_start).toLocaleDateString()}</span>
                  {sale.date_end && <span>- {new Date(sale.date_end).toLocaleDateString()}</span>}
                </div>
                {sale.price_range && (
                  <div className="flex items-center gap-1.5 text-matrix-amber terminal-xs">
                    <DollarSign className="w-3 h-3 flex-shrink-0" />
                    <span>{sale.price_range}</span>
                  </div>
                )}
              </div>

              {sale.description && (
                <p className="text-matrix-green-dim/40 terminal-xs line-clamp-2 mb-3">{sale.description}</p>
              )}

              <div className="flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {sale.categories?.slice(0, 3).map((cat) => (
                    <span key={cat} className="text-[9px] px-1.5 py-0.5 border border-matrix-panel-border rounded text-matrix-green-dim/40">
                      {cat}
                    </span>
                  ))}
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${sale.pushed ? 'bg-matrix-green/10 text-matrix-green' : 'bg-matrix-amber/10 text-matrix-amber'}`}>
                  {sale.pushed ? 'PUSHED' : 'PENDING'}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalCount > 50 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="neon-btn text-[10px] px-4 py-1 disabled:opacity-30"
          >
            PREV
          </button>
          <span className="terminal-xs text-matrix-green-dim/40">
            Page {page} of {Math.ceil(totalCount / 50)}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(totalCount / 50)}
            className="neon-btn text-[10px] px-4 py-1 disabled:opacity-30"
          >
            NEXT
          </button>
        </div>
      )}
    </div>
  );
}
