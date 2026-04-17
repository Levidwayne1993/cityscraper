'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Bitcoin, TrendingUp, TrendingDown, RefreshCw, ExternalLink, Newspaper, BarChart3, Flame } from 'lucide-react';

interface CryptoAsset {
  id: string;
  symbol: string;
  name: string;
  price_usd: number;
  change_24h: number;
  change_7d: number;
  market_cap: number;
  volume_24h: number;
  rank: number;
  image_url: string | null;
  scraped_at: string;
}

interface CryptoNews {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  related_coins: string[];
}

interface DeFiYield {
  id: string;
  protocol: string;
  pool: string;
  chain: string;
  apy: number;
  tvl: number;
  risk_level: 'low' | 'medium' | 'high';
}

export default function CryptoPage() {
  const [assets, setAssets] = useState<CryptoAsset[]>([]);
  const [news, setNews] = useState<CryptoNews[]>([]);
  const [yields, setYields] = useState<DeFiYield[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'prices' | 'news' | 'defi'>('prices');

  useEffect(() => {
    fetchCryptoData();
  }, []);

  async function fetchCryptoData() {
    setLoading(true);
    try {
      const [pricesRes, newsRes, yieldsRes] = await Promise.all([
        fetch('/api/data/crypto?type=prices&limit=100'),
        fetch('/api/data/crypto?type=news&limit=30'),
        fetch('/api/data/crypto?type=defi&limit=30'),
      ]);

      if (pricesRes.ok) { const d = await pricesRes.json(); setAssets(d.items || []); }
      if (newsRes.ok) { const d = await newsRes.json(); setNews(d.items || []); }
      if (yieldsRes.ok) { const d = await yieldsRes.json(); setYields(d.items || []); }
    } catch (err) {
      console.error('Failed to fetch crypto data:', err);
    } finally {
      setLoading(false);
    }
  }

  function formatUSD(n: number) {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `$${n.toFixed(6)}`;
  }

  const TABS = [
    { key: 'prices', label: 'LIVE PRICES', icon: <BarChart3 className="w-4 h-4" /> },
    { key: 'news', label: 'NEWS FEED', icon: <Newspaper className="w-4 h-4" /> },
    { key: 'defi', label: 'DEFI YIELDS', icon: <Flame className="w-4 h-4" /> },
  ] as const;

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-display text-2xl tracking-wider text-glow-amber flex items-center gap-3">
          <Bitcoin className="w-6 h-6 text-matrix-amber" />
          CRYPTO PIPELINE
        </h1>
        <p className="text-matrix-green-dim/50 terminal-sm mt-1">
          Feeding CryptoToolbox.org | Live market data, news, and DeFi yields
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded font-display text-xs tracking-wider transition-all ${
              activeTab === tab.key
                ? 'bg-matrix-amber/10 text-matrix-amber border border-matrix-amber/30'
                : 'text-matrix-green-dim/40 hover:text-matrix-amber hover:bg-matrix-amber/5 border border-transparent'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={fetchCryptoData} className="neon-btn-amber text-[10px] px-3 py-1 flex items-center gap-1 border rounded">
          <RefreshCw className="w-3 h-3" /> REFRESH
        </button>
      </div>

      {loading ? (
        <div className="text-center py-20">
          <RefreshCw className="w-8 h-8 text-matrix-amber animate-spin mx-auto mb-4" />
          <p className="text-matrix-green-dim/50 terminal-sm">Loading crypto data...</p>
        </div>
      ) : (
        <>
          {/* PRICES TAB */}
          {activeTab === 'prices' && (
            <div className="glass-panel overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full terminal-sm">
                  <thead>
                    <tr className="text-matrix-green-dim/40 border-b border-matrix-panel-border text-xs">
                      <th className="text-left py-3 px-4">#</th>
                      <th className="text-left py-3 px-2">Asset</th>
                      <th className="text-right py-3 px-4">Price</th>
                      <th className="text-right py-3 px-4">24h</th>
                      <th className="text-right py-3 px-4">7d</th>
                      <th className="text-right py-3 px-4 hidden md:table-cell">Market Cap</th>
                      <th className="text-right py-3 px-4 hidden lg:table-cell">Volume 24h</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset, i) => (
                      <motion.tr
                        key={asset.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.02 }}
                        className="border-b border-matrix-panel-border/30 hover:bg-matrix-amber/5"
                      >
                        <td className="py-2 px-4 text-matrix-green-dim/30">{asset.rank}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            {asset.image_url && <img src={asset.image_url} alt="" className="w-5 h-5 rounded-full" />}
                            <span className="text-matrix-amber font-bold">{asset.symbol.toUpperCase()}</span>
                            <span className="text-matrix-green-dim/30 hidden sm:inline">{asset.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-4 text-right text-matrix-green font-mono">{formatUSD(asset.price_usd)}</td>
                        <td className={`py-2 px-4 text-right font-mono ${asset.change_24h >= 0 ? 'text-matrix-green' : 'text-matrix-red'}`}>
                          <span className="flex items-center justify-end gap-1">
                            {asset.change_24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {asset.change_24h.toFixed(2)}%
                          </span>
                        </td>
                        <td className={`py-2 px-4 text-right font-mono ${asset.change_7d >= 0 ? 'text-matrix-green' : 'text-matrix-red'}`}>
                          {asset.change_7d.toFixed(2)}%
                        </td>
                        <td className="py-2 px-4 text-right text-matrix-green-dim/50 hidden md:table-cell">{formatUSD(asset.market_cap)}</td>
                        <td className="py-2 px-4 text-right text-matrix-green-dim/30 hidden lg:table-cell">{formatUSD(asset.volume_24h)}</td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* NEWS TAB */}
          {activeTab === 'news' && (
            <div className="grid md:grid-cols-2 gap-4">
              {news.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="glass-panel p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${
                      item.sentiment === 'positive' ? 'bg-matrix-green/10 text-matrix-green' :
                      item.sentiment === 'negative' ? 'bg-matrix-red/10 text-matrix-red' :
                      'bg-matrix-green-dim/10 text-matrix-green-dim/50'
                    }`}>
                      {item.sentiment}
                    </span>
                    <a href={item.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 text-matrix-green-dim/30 hover:text-matrix-amber" />
                    </a>
                  </div>
                  <h3 className="text-matrix-amber terminal-sm font-bold mb-2 line-clamp-2">{item.title}</h3>
                  <p className="text-matrix-green-dim/40 terminal-xs line-clamp-3 mb-3">{item.summary}</p>
                  <div className="flex items-center justify-between">
                    <span className="terminal-xs text-matrix-green-dim/20">{item.source}</span>
                    <span className="terminal-xs text-matrix-green-dim/20">
                      {new Date(item.published_at).toLocaleDateString()}
                    </span>
                  </div>
                  {item.related_coins?.length > 0 && (
                    <div className="flex gap-1 mt-2">
                      {item.related_coins.map((coin) => (
                        <span key={coin} className="text-[9px] px-1.5 py-0.5 border border-matrix-amber/20 text-matrix-amber/60 rounded">
                          {coin}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}

          {/* DEFI TAB */}
          {activeTab === 'defi' && (
            <div className="glass-panel overflow-hidden">
              <table className="w-full terminal-sm">
                <thead>
                  <tr className="text-matrix-green-dim/40 border-b border-matrix-panel-border text-xs">
                    <th className="text-left py-3 px-4">Protocol</th>
                    <th className="text-left py-3 px-2">Pool</th>
                    <th className="text-left py-3 px-2">Chain</th>
                    <th className="text-right py-3 px-4">APY</th>
                    <th className="text-right py-3 px-4">TVL</th>
                    <th className="text-center py-3 px-4">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {yields.map((y, i) => (
                    <motion.tr
                      key={y.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-matrix-panel-border/30 hover:bg-matrix-amber/5"
                    >
                      <td className="py-2 px-4 text-matrix-amber font-bold">{y.protocol}</td>
                      <td className="py-2 px-2 text-matrix-green-dim/60">{y.pool}</td>
                      <td className="py-2 px-2 text-matrix-cyan">{y.chain}</td>
                      <td className="py-2 px-4 text-right text-matrix-green font-bold">{y.apy.toFixed(2)}%</td>
                      <td className="py-2 px-4 text-right text-matrix-green-dim/50">{formatUSD(y.tvl)}</td>
                      <td className="py-2 px-4 text-center">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase ${
                          y.risk_level === 'low' ? 'bg-matrix-green/10 text-matrix-green' :
                          y.risk_level === 'medium' ? 'bg-matrix-amber/10 text-matrix-amber' :
                          'bg-matrix-red/10 text-matrix-red'
                        }`}>
                          {y.risk_level}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
