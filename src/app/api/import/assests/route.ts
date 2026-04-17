// ============================================================
// FILE: src/app/api/import/assets/route.ts  (plus news, defi, trending, sentiment, global)
// DEPLOY TO: CryptoToolbox.org repo (cryptotoolbox)
// STATUS: MISSING — no receiver endpoints existed on CryptoToolbox
// PURPOSE: Receives pushed crypto data from CityScraper
// NOTE: Create one route.ts per sub-endpoint OR use this
//       single unified endpoint that accepts a "type" field.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function validateImportKey(req: NextRequest): boolean {
  const apiKey =
    req.headers.get('x-api-key') ||
    req.headers.get('authorization')?.replace('Bearer ', '');
  return apiKey === process.env.IMPORT_API_KEY;
}

// ==================== UNIFIED IMPORT ENDPOINT ====================
// POST /api/import/crypto
// Body: { type: "assets"|"news"|"defi"|"trending"|"sentiment"|"global", items: [...] }

export async function POST(req: NextRequest) {
  if (!validateImportKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { type, items } = body;

    if (!type) {
      return NextResponse.json(
        { success: false, error: 'Missing "type" field. Use: assets, news, defi, trending, sentiment, global' },
        { status: 400 }
      );
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No items provided' },
        { status: 400 }
      );
    }

    let tableName: string;
    let conflictKey: string;
    let mappedItems: any[];

    switch (type) {
      case 'assets':
        tableName = 'assets';
        conflictKey = 'coin_id,source';
        mappedItems = items.map((a: any) => ({
          ...a,
          imported_at: new Date().toISOString(),
        }));
        break;

      case 'news':
        tableName = 'news';
        conflictKey = 'url';
        mappedItems = items.map((n: any) => ({
          ...n,
          imported_at: new Date().toISOString(),
        }));
        break;

      case 'defi':
        tableName = 'defi_pools';
        conflictKey = 'pool_id';
        mappedItems = items.map((d: any) => ({
          ...d,
          imported_at: new Date().toISOString(),
        }));
        break;

      case 'trending':
        tableName = 'trending';
        conflictKey = 'coin_id';
        mappedItems = items.map((t: any) => ({
          ...t,
          imported_at: new Date().toISOString(),
        }));
        break;

      case 'sentiment':
        tableName = 'sentiment';
        conflictKey = 'type';
        mappedItems = items.map((s: any) => ({
          ...s,
          imported_at: new Date().toISOString(),
        }));
        break;

      case 'global':
        tableName = 'market_global';
        conflictKey = 'id';
        mappedItems = items.map((g: any) => ({
          ...g,
          imported_at: new Date().toISOString(),
        }));
        break;

      default:
        return NextResponse.json(
          { success: false, error: `Unknown type: "${type}". Use: assets, news, defi, trending, sentiment, global` },
          { status: 400 }
        );
    }

    // Batch upsert
    const batchSize = 100;
    let totalInserted = 0;
    let errors = 0;

    for (let i = 0; i < mappedItems.length; i += batchSize) {
      const batch = mappedItems.slice(i, i + batchSize);
      const { error } = await supabase
        .from(tableName)
        .upsert(batch, { onConflict: conflictKey });

      if (error) {
        console.error(`[Import:${type}] Batch error:`, error);
        errors++;
      } else {
        totalInserted += batch.length;
      }
    }

    return NextResponse.json({
      success: errors === 0,
      type,
      imported: totalInserted,
      errors,
      total: items.length,
    });
  } catch (err: any) {
    console.error('[Import:Crypto] Fatal error:', err.message);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'import/crypto',
    status: 'ready',
    method: 'POST',
    usage: '{ type: "assets"|"news"|"defi"|"trending"|"sentiment"|"global", items: [...] }',
  });
}
