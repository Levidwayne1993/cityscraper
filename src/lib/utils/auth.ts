import { NextRequest, NextResponse } from 'next/server';

/**
 * Validates the API key on incoming requests.
 * All scrape/push/cron endpoints must call this.
 */
export function validateApiKey(req: NextRequest): NextResponse | null {
  const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '');
  const cronSecret = req.headers.get('x-vercel-cron-secret');

  // Allow Vercel cron jobs
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    return null; // authorized
  }

  // Check API key
  if (!apiKey || apiKey !== process.env.CITYSCRAPER_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized', message: 'Invalid or missing API key' },
      { status: 401 }
    );
  }

  return null; // authorized
}

/**
 * CORS headers for API responses
 */
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  };
}
