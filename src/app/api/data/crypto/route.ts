import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'prices';
  const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

  try {
    let data: any[] = [];
    let total = 0;

    switch (type) {
      case 'prices': {
        const result = await supabaseAdmin
          .from('crypto_assets')
          .select('*', { count: 'exact' })
          .eq('source', 'coingecko')
          .order('rank', { ascending: true })
          .limit(limit);
        data = result.data || [];
        total = result.count || 0;
        break;
      }
      case 'news': {
        const result = await supabaseAdmin
          .from('crypto_news')
          .select('*', { count: 'exact' })
          .order('published_at', { ascending: false })
          .limit(limit);
        data = result.data || [];
        total = result.count || 0;
        break;
      }
      case 'defi': {
        const result = await supabaseAdmin
          .from('defi_yields')
          .select('*', { count: 'exact' })
          .order('tvl', { ascending: false })
          .limit(limit);
        data = result.data || [];
        total = result.count || 0;
        break;
      }
      case 'trending': {
        const result = await supabaseAdmin
          .from('crypto_trending')
          .select('*')
          .limit(20);
        data = result.data || [];
        break;
      }
      case 'sentiment': {
        const result = await supabaseAdmin
          .from('crypto_sentiment')
          .select('*')
          .eq('type', 'fear_greed')
          .single();
        data = result.data ? [result.data] : [];
        break;
      }
      case 'global': {
        const result = await supabaseAdmin
          .from('crypto_global')
          .select('*')
          .eq('id', 'latest')
          .single();
        data = result.data ? [result.data] : [];
        break;
      }
    }

    return NextResponse.json({ items: data, total, type });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
