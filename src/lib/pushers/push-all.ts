// ============================================================
// FILE: src/lib/pushers/push-all.ts
// STATUS: MISSING — referenced in package.json but never created
// PURPOSE: Orchestrates all three push modules in sequence
// ============================================================

import { pushToYardShoppers } from './yard-shoppers-push';
import { pushToCheapHouseHub } from './cheap-house-push';
import { pushToCryptoToolbox } from './crypto-toolbox-push';
import { logScrapeRun } from '@/lib/supabase';

export interface PushAllResult {
  success: boolean;
  totalPushed: number;
  totalErrors: number;
  results: {
    yardShoppers: { success: boolean; itemsPushed: number; errors: number };
    cheapHouseHub: { success: boolean; itemsPushed: number; errors: number };
    cryptoToolbox: { success: boolean; itemsPushed: number; errors: number };
  };
  duration: string;
}

export async function pushAll(): Promise<PushAllResult> {
  console.log('[PushAll] ========== Starting full push to all targets ==========');
  const startTime = Date.now();

  // --- YardShoppers ---
  let ysResult = { success: false, itemsPushed: 0, errors: 1 };
  try {
    ysResult = await pushToYardShoppers();
    console.log(`[PushAll] YardShoppers: ${ysResult.itemsPushed} pushed, ${ysResult.errors} errors`);
  } catch (err: any) {
    console.error('[PushAll] YardShoppers fatal:', err.message);
    ysResult = { success: false, itemsPushed: 0, errors: 1 };
  }

  // --- CheapHouseHub ---
  let chResult = { success: false, itemsPushed: 0, errors: 1 };
  try {
    chResult = await pushToCheapHouseHub();
    console.log(`[PushAll] CheapHouseHub: ${chResult.itemsPushed} pushed, ${chResult.errors} errors`);
  } catch (err: any) {
    console.error('[PushAll] CheapHouseHub fatal:', err.message);
    chResult = { success: false, itemsPushed: 0, errors: 1 };
  }

  // --- CryptoToolbox ---
  let ctResult = { success: false, itemsPushed: 0, errors: 1 };
  try {
    ctResult = await pushToCryptoToolbox();
    console.log(`[PushAll] CryptoToolbox: ${ctResult.itemsPushed} pushed, ${ctResult.errors} errors`);
  } catch (err: any) {
    console.error('[PushAll] CryptoToolbox fatal:', err.message);
    ctResult = { success: false, itemsPushed: 0, errors: 1 };
  }

  const totalPushed = ysResult.itemsPushed + chResult.itemsPushed + ctResult.itemsPushed;
  const totalErrors = ysResult.errors + chResult.errors + ctResult.errors;
  const duration = Date.now() - startTime;

  console.log(
    `[PushAll] ========== Complete: ${totalPushed} pushed, ${totalErrors} errors, ${(duration / 1000).toFixed(1)}s ==========`
  );

  return {
    success: totalErrors === 0,
    totalPushed,
    totalErrors,
    results: {
      yardShoppers: ysResult,
      cheapHouseHub: chResult,
      cryptoToolbox: ctResult,
    },
    duration: `${(duration / 1000).toFixed(1)}s`,
  };
}

// Allow CLI execution: npm run push:all
if (require.main === module) {
  pushAll()
    .then((result) => {
      console.log('\n[PushAll] Final Result:', JSON.stringify(result, null, 2));
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[PushAll] Unhandled error:', err);
      process.exit(1);
    });
}
