// ============================================================
// FILE: scripts/push-to-yardshoppers.ts (CityScraper project)
// STANDALONE push — loads its own env, verbose logging
// RUN: npx tsx scripts/push-to-yardshoppers.ts
// ============================================================

import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SOURCE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SOURCE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEST_URL   = process.env.YARDSHOPPERS_SUPABASE_URL || '';
const DEST_KEY   = process.env.YARDSHOPPERS_SUPABASE_KEY || '';

console.log('');
console.log('═══════════════════════════════════════════════════════');
console.log('  YARD SHOPPERS PUSH — STANDALONE');
console.log('═══════════════════════════════════════════════════════');
console.log(`  Source (cityscraper):      ${SOURCE_URL ? '✅' : '❌ MISSING'}`);
console.log(`  Destination (yardshoppers): ${DEST_URL ? '✅' : '❌ MISSING'}`);
console.log('');

if (!SOURCE_URL || !SOURCE_KEY) {
  console.error('❌ Missing cityscraper Supabase env vars'); process.exit(1);
}
if (!DEST_URL || !DEST_KEY) {
  console.error('❌ Missing YARDSHOPPERS_SUPABASE_URL or YARDSHOPPERS_SUPABASE_KEY'); process.exit(1);
}

const source = createClient(SOURCE_URL, SOURCE_KEY);
const dest   = createClient(DEST_URL, DEST_KEY);

const BATCH_SIZE = 200;

async function main() {
  const { count, error: countErr } = await source
    .from('yard_sales').select('*', { count: 'exact', head: true });
  if (countErr) { console.error('❌ Count failed:', countErr.message); process.exit(1); }
  console.log(`📊 Yard sales in cityscraper: ${count}`);

  const { count: destCount } = await dest
    .from('external_sales').select('*', { count: 'exact', head: true });
  console.log(`📊 Current listings in yardshoppers: ${destCount}`);
  console.log('');

  if (!count || count === 0) { console.log('⚠️ No sales to push.'); process.exit(0); }

  let totalPushed = 0;
  let offset = 0;

  while (true) {
    const { data, error: fetchErr } = await source
      .from('yard_sales').select('*')
      .range(offset, offset + BATCH_SIZE - 1)
      .order('scraped_at', { ascending: false });

    if (fetchErr) { console.error(`❌ Fetch error:`, fetchErr.message); break; }
    if (!data || data.length === 0) break;

    console.log(`  📦 Fetched ${data.length} records (offset ${offset})...`);

        const mapped = data.map((s: any) => ({
      source_id:       s.source_id,
      source:          s.source,
      title:           s.title,
      description:     s.description,
      address:         s.address,
      city:            s.city,
      state:           s.state,
      zip:             s.zip,
      latitude:        s.lat,
      longitude:       s.lng,
      sale_date:       s.date_start,
      sale_time_start: s.time_start,
      sale_time_end:   s.time_end,
      price:           s.price_range,
      categories:      s.categories,
      source_url:      s.source_url,
      photo_urls:      s.image_urls,
      expires_at:      s.expires_at,
      collected_at:    s.scraped_at,
    }));

    const { error: pushErr } = await dest
      .from('external_sales')
      .upsert(mapped, { onConflict: 'source_id', ignoreDuplicates: false });

    if (pushErr) {
      console.error(`  ❌ Push error:`, pushErr.message);
      console.error(`  Details:`, pushErr);
      break;
    }

    totalPushed += data.length;
    console.log(`  ✅ Pushed ${data.length} → yardshoppers (${totalPushed} total)`);

    const ids = data.map((s: any) => s.source_id);
    await source.from('yard_sales').update({ pushed_at: new Date().toISOString() }).in('source_id', ids);

    if (data.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  const { count: newCount } = await dest
    .from('external_sales').select('*', { count: 'exact', head: true });

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  ✅ DONE — Pushed ${totalPushed} listings`);
  console.log(`  Yardshoppers before: ${destCount}`);
  console.log(`  Yardshoppers after:  ${newCount}`);
  console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => { console.error('💀 Fatal:', err); process.exit(1); });
