import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/utils/auth';
import { scrapeCrypto } from '@/lib/scrapers/crypto-scraper';
import { logScrapeRun } from '@/lib/supabase';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const authError = validateApiKey(req);
  if (authError) return authError;

  const startTime = Date.now();

  try {
    await logScrapeRun('crypto', 'running');
    const result = await scrapeCrypto();
    const duration = Date.now() - startTime;

    await logScrapeRun('crypto', result.success ? 'success' : 'error', result.itemsFound, 0, result.errors, duration);

    return NextResponse.json({
      success: result.success,
      pipeline: 'crypto',
      itemsFound: result.itemsFound,
      errors: result.errors,
      duration: `${(duration / 1000).toFixed(1)}s`,
      details: result.details,
    });
  } catch (err: any) {
    const duration = Date.now() - startTime;
    await logScrapeRun('crypto', 'error', 0, 0, 1, duration, err.message);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ pipeline: 'crypto', status: 'ready', method: 'POST to trigger' });
}
