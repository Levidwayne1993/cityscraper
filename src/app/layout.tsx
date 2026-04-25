// FILE: src/app/layout.tsx
// REPLACES: src/app/layout.tsx
// CLEANED: Removed CheapHouseHub and CryptoToolbox from metadata

import type { Metadata } from 'next';
import './globals.css';
import { Navbar } from '@/components/Navbar';
import { MatrixRain } from '@/components/MatrixRain';
import { CityScape } from '@/components/CityScape';

export const metadata: Metadata = {
  title: 'CityScraper.org | Advanced Multi-Site Aggregator Engine',
  description:
    'Command center powering YardShoppers.com with real-time yard sale data aggregation.',
  keywords: 'aggregator, scraper, yard sales, garage sales, estate sales, data engine',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-matrix-black text-matrix-green font-mono antialiased">
        {/* Matrix Rain Background */}
        <MatrixRain />

        {/* City Skyline Silhouette */}
        <CityScape />

        {/* Scan Line Effect */}
        <div className="scan-line" />

        {/* Grid Overlay */}
        <div className="fixed inset-0 grid-overlay pointer-events-none z-[1]" />

        {/* Main Application */}
        <div className="main-content">
          <Navbar />
          <main className="pt-16">{children}</main>
        </div>
      </body>
    </html>
  );
}
