import { NextRequest, NextResponse } from 'next/server';
import { pushToYardShoppers } from '@/lib/pushers/yard-shoppers-push';
import { pushToCheapHouseHub } from '@/lib/pushers/cheap-house-push';
import { pushToCryptoToolbox } from '@/lib/pushers/crypto-toolbox-push';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('authorization')?.replace('Bearer ', '') ||
    req.headers.get('x-api-key') ||
    '';
  const validSecret = process.env.CRON_SECRET || '';
  if (!validSecret || secret !== validSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[PUSH] ========== Starting push phase ==========');
  const startTime = Date.now();
  const results: Record<string, any> = {};

  try {
    results.yard_shoppers = await pushToYardShoppers();
    console.log(`[PUSH] YardShoppers: ${results.yard_shoppers.itemsPushed} items pushed`);
  } catch (err: any) {
    results.yard_shoppers = { success: false, itemsPushed: 0, error: err.message };
    console.error('[PUSH] YardShoppers failed:', err.message);
  }

  try {
    results.cheap_house_hub = await pushToCheapHouseHub();
    console.log(`[PUSH] CheapHouseHub: ${results.cheap_house_hub.itemsPushed} items pushed`);
  } catch (err: any) {
    results.cheap_house_hub = { success: false, itemsPushed: 0, error: err.message };
    console.error('[PUSH] CheapHouseHub failed:', err.message);
  }

  try {
    results.crypto_toolbox = await pushToCryptoToolbox();
    console.log(`[PUSH] CryptoToolbox: ${results.crypto_toolbox.itemsPushed} items pushed`);
  } catch (err: any) {
    results.crypto_toolbox = { success: false, itemsPushed: 0, error: err.message };
    console.error('[PUSH] CryptoToolbox failed:', err.message);
  }

  const duration = Date.now() - startTime;
  const totalPushed =
    (results.yard_shoppers?.itemsPushed || 0) +
    (results.cheap_house_hub?.itemsPushed || 0) +
    (results.crypto_toolbox?.itemsPushed || 0);

  console.log(`[PUSH] Complete: ${totalPushed} pushed in ${(duration / 1000).toFixed(1)}s`);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    duration: `${(duration / 1000).toFixed(1)}s`,
    totalPushed,
    results,
  });
}
