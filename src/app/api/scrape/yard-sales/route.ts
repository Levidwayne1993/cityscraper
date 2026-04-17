import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/utils/auth';
import { scrapeYardSales } from '@/lib/scrapers/yard-sale-scraper';
import { logScrapeRun } from '@/lib/supabase';

export const maxDuration = 300; // 5 min timeout for Vercel Pro

export async function POST(req: NextRequest) {
  const authError = validateApiKey(req);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    await logScrapeRun('yard-sales', 'running');
    const result = await scrapeYardSales();
    const duration = Date.now() - startTime;

    await logScrapeRun(
      'yard-sales',
      result.success ? 'success' : 'error',
      result.itemsFound,
      0,
      result.errors,
      duration
    );

    return NextResponse.json({
      success: result.success,
      pipeline: 'yard-sales',
      itemsFound: result.itemsFound,
      errors: result.errors,
      duration: `${(duration / 1000).toFixed(1)}s`,
      details: result.details,
    });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    await logScrapeRun('yard-sales', 'error', 0, 0, 1, duration, err.message);

    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ pipeline: 'yard-sales', status: 'ready', method: 'POST to trigger' });
}
