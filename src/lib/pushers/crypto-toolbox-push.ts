import { supabaseAdmin, getCryptoToolboxClient } from '@/lib/supabase';
import axios from 'axios';

// ============================================================
//  CRYPTO TOOLBOX PUSH MODULE
//  Pushes scraped crypto data to CryptoToolbox.org
// ============================================================

export async function pushToCryptoToolbox(): Promise<{
  success: boolean;
  itemsPushed: number;
  errors: number;
}> {
  console.log('[Push:CryptoToolbox] Starting push...');
  let itemsPushed = 0;
  let errors = 0;

  try {
    const useDirectDB = !!process.env.CRYPTOTOOLBOX_SUPABASE_URL;
    const useAPI = !!process.env.CRYPTOTOOLBOX_API_URL;

    // --- Push Crypto Assets (prices) ---
    const { data: assets } = await supabaseAdmin
      .from('crypto_assets')
      .select('*')
      .order('rank', { ascending: true })
      .limit(500);

    // --- Push News ---
    const { data: news } = await supabaseAdmin
      .from('crypto_news')
      .select('*')
      .order('published_at', { ascending: false })
      .limit(100);

    // --- Push DeFi Yields ---
    const { data: yields } = await supabaseAdmin
      .from('defi_yields')
      .select('*')
      .order('tvl', { ascending: false })
      .limit(200);

    // --- Push Sentiment ---
    const { data: sentiment } = await supabaseAdmin
      .from('crypto_sentiment')
      .select('*')
      .limit(10);

    // --- Push Trending ---
    const { data: trending } = await supabaseAdmin
      .from('crypto_trending')
      .select('*')
      .limit(20);

    // --- Push Global Data ---
    const { data: globalData } = await supabaseAdmin
      .from('crypto_global')
      .select('*')
      .eq('id', 'latest')
      .single();

    if (useDirectDB) {
      const ctClient = getCryptoToolboxClient();

      // Push assets
      if (assets?.length) {
        const { error } = await ctClient.from('assets').upsert(
          assets.map((a) => ({ ...a, imported_at: new Date().toISOString() })),
          { onConflict: 'coin_id,source' }
        );
        if (error) errors++;
        else itemsPushed += assets.length;
      }

      // Push news
      if (news?.length) {
        const { error } = await ctClient.from('news').upsert(
          news.map((n) => ({ ...n, imported_at: new Date().toISOString() })),
          { onConflict: 'url' }
        );
        if (error) errors++;
        else itemsPushed += news.length;
      }

      // Push DeFi
      if (yields?.length) {
        const { error } = await ctClient.from('defi_pools').upsert(
          yields.map((y) => ({ ...y, imported_at: new Date().toISOString() })),
          { onConflict: 'pool_id' }
        );
        if (error) errors++;
        else itemsPushed += yields.length;
      }

      // Push sentiment
      if (sentiment?.length) {
        const { error } = await ctClient.from('sentiment').upsert(sentiment, { onConflict: 'type' });
        if (error) errors++;
        else itemsPushed += sentiment.length;
      }

      // Push trending
      if (trending?.length) {
        const { error } = await ctClient.from('trending').upsert(trending, { onConflict: 'coin_id' });
        if (error) errors++;
        else itemsPushed += trending.length;
      }

      // Push global
      if (globalData) {
        const { error } = await ctClient.from('market_global').upsert(
          { ...globalData, imported_at: new Date().toISOString() },
          { onConflict: 'id' }
        );
        if (error) errors++;
        else itemsPushed++;
      }

    } else if (useAPI) {
      const apiUrl = process.env.CRYPTOTOOLBOX_API_URL;
      const apiKey = process.env.CRYPTOTOOLBOX_API_KEY;
      const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey || '' };

      const pushBatch = async (endpoint: string, data: any[]) => {
        try {
          const res = await axios.post(`${apiUrl}/import/${endpoint}`, { items: data }, { headers, timeout: 30000 });
          if (res.data?.success) itemsPushed += data.length;
          else errors++;
        } catch (err: any) {
          console.error(`[Push:CryptoToolbox] ${endpoint} API error:`, err.message);
          errors++;
        }
      };

      if (assets?.length) await pushBatch('assets', assets);
      if (news?.length) await pushBatch('news', news);
      if (yields?.length) await pushBatch('defi', yields);
      if (trending?.length) await pushBatch('trending', trending);
      if (sentiment?.length) await pushBatch('sentiment', sentiment);
      if (globalData) await pushBatch('global', [globalData]);

    } else {
      console.warn('[Push:CryptoToolbox] No push target configured');
      return { success: false, itemsPushed: 0, errors: 1 };
    }

  } catch (err: any) {
    console.error('[Push:CryptoToolbox] Fatal error:', err.message);
    errors++;
  }

  console.log(`[Push:CryptoToolbox] Complete: ${itemsPushed} pushed, ${errors} errors`);
  return { success: errors === 0, itemsPushed, errors };
}
