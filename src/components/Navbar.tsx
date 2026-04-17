'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, X, Activity, Home, Tag, Bitcoin, Settings, LayoutDashboard } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: <Home className="w-4 h-4" /> },
  { href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { href: '/yard-sales', label: 'Yard Sales', icon: <Tag className="w-4 h-4" /> },
  { href: '/cheap-homes', label: 'Cheap Homes', icon: <Home className="w-4 h-4" /> },
  { href: '/crypto', label: 'Crypto', icon: <Bitcoin className="w-4 h-4" /> },
  { href: '/settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 glass-panel rounded-none border-x-0 border-t-0">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group">
          <Activity className="w-5 h-5 text-matrix-green group-hover:text-matrix-cyan transition-colors" />
          <span className="font-display text-sm tracking-[0.2em] text-matrix-green text-glow">
            CITY<span className="text-matrix-cyan">SCRAPER</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-display tracking-wider transition-all ${
                  active
                    ? 'text-matrix-green bg-matrix-green/10 border border-matrix-green/30'
                    : 'text-matrix-green-dim/60 hover:text-matrix-green hover:bg-matrix-green/5'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Status Indicator */}
        <div className="hidden md:flex items-center gap-2">
          <div className="status-dot status-dot-green" />
          <span className="terminal-xs text-matrix-green-dim/50">ONLINE</span>
        </div>

        {/* Mobile Toggle */}
        <button
          className="md:hidden text-matrix-green"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden glass-panel rounded-none border-x-0 p-4 space-y-2">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-all ${
                  active
                    ? 'text-matrix-green bg-matrix-green/10'
                    : 'text-matrix-green-dim/60 hover:text-matrix-green'
                }`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
