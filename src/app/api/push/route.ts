// ============================================================
// FILE: src/app/api/push/route.ts
// STATUS: MISSING — no API endpoint existed to trigger pushes
// PURPOSE: Manual push trigger endpoint (POST to push all sites)
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/utils/auth';
import { pushToYardShoppers } from '@/lib/pushers/yard-shoppers-push';
import { pushToCheapHouseHub } from '@/lib/pushers/cheap-house-push';
import { pushToCryptoToolbox } from '@/lib/pushers/crypto-toolbox-push';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const authError = validateApiKey(req);
  if (authError) return authError;

  const startTime = Date.now();
  const results: any = {};

  try {
    // Determine which pipelines to push (default: all)
    const body = await req.json().catch(() => ({}));
    const pipelines: string[] = body.pipelines || ['yard-sales', 'cheap-homes', 'crypto'];

    if (pipelines.includes('yard-sales')) {
      try {
        results.yardShoppers = await pushToYardShoppers();
      } catch (err: any) {
        results.yardShoppers = { success: false, error: err.message, itemsPushed: 0, errors: 1 };
      }
    }

    if (pipelines.includes('cheap-homes')) {
      try {
        results.cheapHouseHub = await pushToCheapHouseHub();
      } catch (err: any) {
        results.cheapHouseHub = { success: false, error: err.message, itemsPushed: 0, errors: 1 };
      }
    }

    if (pipelines.includes('crypto')) {
      try {
        results.cryptoToolbox = await pushToCryptoToolbox();
      } catch (err: any) {
        results.cryptoToolbox = { success: false, error: err.message, itemsPushed: 0, errors: 1 };
      }
    }

    const totalPushed =
      (results.yardShoppers?.itemsPushed || 0) +
      (results.cheapHouseHub?.itemsPushed || 0) +
      (results.cryptoToolbox?.itemsPushed || 0);

    const totalErrors =
      (results.yardShoppers?.errors || 0) +
      (results.cheapHouseHub?.errors || 0) +
      (results.cryptoToolbox?.errors || 0);

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: totalErrors === 0,
      totalPushed,
      totalErrors,
      duration: `${(duration / 1000).toFixed(1)}s`,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message, results },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'push',
    status: 'ready',
    method: 'POST to trigger',
    usage: 'POST with optional body { "pipelines": ["yard-sales", "cheap-homes", "crypto"] }',
  });
}
