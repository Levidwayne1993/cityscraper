// FILE: src/app/page.tsx
// REPLACES: src/app/page.tsx
// CLEANED: Removed CheapHouseHub, CryptoToolbox pipelines, counts, terminal refs, footer refs

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Activity, Database, Zap, Globe, ArrowRight, BarChart3, Shield } from 'lucide-react';
import Link from 'next/link';

const PIPELINES = [
  {
    name: 'YardShoppers.com',
    description: 'Yard sales, garage sales, estate sales — nationwide aggregation',
    icon: '🏷️',
    color: 'green',
    href: '/dashboard?tab=yard-sales',
    stats: { label: 'Sales Tracked', key: 'yard_sales' },
  },
];

const FEATURES = [
  { icon: <Zap className="w-5 h-5" />, title: 'Real-Time Scraping', desc: 'Automated collection every 4 hours across all pipelines' },
  { icon: <Database className="w-5 h-5" />, title: 'Supabase Storage', desc: 'PostgreSQL-backed with full-text search and geo queries' },
  { icon: <Globe className="w-5 h-5" />, title: 'Multi-Site Push', desc: 'One scrape feeds YardShoppers.com automatically' },
  { icon: <Shield className="w-5 h-5" />, title: 'API-Key Protected', desc: 'Every endpoint locked behind authentication' },
  { icon: <BarChart3 className="w-5 h-5" />, title: 'Live Dashboard', desc: 'Monitor scrape health, data volume, and push status' },
  { icon: <Activity className="w-5 h-5" />, title: 'Error Recovery', desc: 'Auto-retry with exponential backoff on failures' },
];

export default function HomePage() {
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [counts, setCounts] = useState({ yard_sales: 0 });

  // Boot-up terminal animation
  useEffect(() => {
    const lines = [
      '> Initializing CityScraper Engine v4.1...',
      '> Connecting to Supabase cluster...',
      '> Loading scraper modules: [yard-sales]',
      '> Verifying API keys... ✓',
      '> Push target configured: yardshoppers.com',
      '> Cron schedule: */4 hours',
      '> System status: OPERATIONAL',
      '> Welcome, Operator.',
    ];
    lines.forEach((line, i) => {
      setTimeout(() => {
        setTerminalLines((prev) => [...prev, line]);
      }, i * 400);
    });
  }, []);

  // Fetch live counts
  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch('/api/health');
        if (res.ok) {
          const data = await res.json();
          setCounts(data.counts || { yard_sales: 0 });
        }
      } catch {
        // Dashboard will show 0 until API is live
      }
    }
    fetchCounts();
  }, []);

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      {/* HERO */}
      <motion.section
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="text-center mb-16 mt-8"
      >
        <h1 className="font-display text-4xl md:text-6xl lg:text-7xl font-black tracking-wider text-glow mb-4">
          CITY<span className="text-matrix-cyan">SCRAPER</span>
        </h1>
        <p className="text-matrix-green-dim text-lg md:text-xl max-w-2xl mx-auto mb-2">
          Advanced Multi-Site Aggregator Engine
        </p>
        <p className="text-matrix-green-dim/60 text-sm max-w-xl mx-auto">
          One engine. One mission. Nationwide yard sale data.
        </p>

        {/* Terminal Boot */}
        <div className="glass-panel max-w-2xl mx-auto mt-10 p-4 text-left">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-matrix-panel-border">
            <div className="w-3 h-3 rounded-full bg-matrix-red/80" />
            <div className="w-3 h-3 rounded-full bg-matrix-amber/80" />
            <div className="w-3 h-3 rounded-full bg-matrix-green/80" />
            <span className="text-matrix-green-dim/50 text-xs ml-2 font-display">
              CITYSCRAPER TERMINAL
            </span>
          </div>
          <div className="terminal-sm space-y-1 min-h-[200px]">
            {terminalLines.map((line, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className={
                  line.includes('OPERATIONAL')
                    ? 'text-matrix-green text-glow font-bold'
                    : line.includes('✓')
                    ? 'text-matrix-cyan'
                    : 'text-matrix-green-dim/80'
                }
              >
                {line}
              </motion.div>
            ))}
            <span className="inline-block w-2 h-4 bg-matrix-green animate-flicker" />
          </div>
        </div>
      </motion.section>

      {/* PIPELINE CARDS */}
      <section className="max-w-6xl mx-auto mb-16">
        <h2 className="font-display text-xl tracking-widest text-matrix-green-dim mb-6 text-center">
          // DATA PIPELINES
        </h2>
        <div className="grid md:grid-cols-1 gap-6 max-w-md mx-auto">
          {PIPELINES.map((pipe, i) => (
            <motion.div
              key={pipe.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 * i, duration: 0.5 }}
            >
              <Link href={pipe.href}>
                <div className="glass-panel p-6 h-full group cursor-pointer transition-all hover:scale-[1.02]">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl">{pipe.icon}</span>
                    <div>
                      <h3 className="font-display text-sm tracking-wider text-matrix-green text-glow">
                        {pipe.name}
                      </h3>
                    </div>
                  </div>
                  <p className="text-matrix-green-dim/70 terminal-sm mb-4">{pipe.description}</p>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-matrix-green-dim/50 terminal-xs">{pipe.stats.label}</span>
                      <p className="text-matrix-green font-bold text-lg">
                        {counts[pipe.stats.key as keyof typeof counts]?.toLocaleString() || '—'}
                      </p>
                    </div>
                    <ArrowRight className="w-5 h-5 text-matrix-green-dim/30 group-hover:text-matrix-green transition-colors" />
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FEATURES GRID */}
      <section className="max-w-5xl mx-auto mb-16">
        <h2 className="font-display text-xl tracking-widest text-matrix-green-dim mb-6 text-center">
          // ENGINE CAPABILITIES
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((feat, i) => (
            <motion.div
              key={feat.title}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 * i }}
              className="glass-panel p-4"
            >
              <div className="flex items-center gap-2 mb-2 text-matrix-cyan">
                {feat.icon}
                <span className="font-display text-xs tracking-wider">{feat.title}</span>
              </div>
              <p className="text-matrix-green-dim/60 terminal-xs">{feat.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="text-center mb-16">
        <Link href="/dashboard">
          <button className="neon-btn font-display">
            Enter Command Center
            <ArrowRight className="inline w-4 h-4 ml-2" />
          </button>
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="text-center text-matrix-green-dim/30 terminal-xs pb-8 border-t border-matrix-panel-border pt-6">
        <p>CITYSCRAPER.ORG v4.1 | Powering YardShoppers</p>
        <p className="mt-1">Built by Levi | {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}
