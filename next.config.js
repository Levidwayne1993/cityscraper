/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow images from external scraping sources
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
      { protocol: 'http', hostname: '**' },
    ],
  },
  // Vercel cron jobs
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,Authorization,x-api-key' },
        ],
      },
    ];
  },
  // Increase serverless function timeout for scraping
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-core', '@sparticuz/chromium', 'cheerio'],
  },
};

module.exports = nextConfig;
