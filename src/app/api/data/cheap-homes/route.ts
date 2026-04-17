import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100);
  const state = searchParams.get('state');
  const type = searchParams.get('type');
  const maxPrice = searchParams.get('max_price');
  const query = searchParams.get('q');
  const offset = (page - 1) * limit;

  try {
    let dbQuery = supabaseAdmin
      .from('cheap_homes')
      .select('*', { count: 'exact' })
      .order('price', { ascending: true })
      .range(offset, offset + limit - 1);

    if (state) dbQuery = dbQuery.eq('state', state);
    if (type) dbQuery = dbQuery.eq('listing_type', type);
    if (maxPrice) dbQuery = dbQuery.lte('price', parseInt(maxPrice));
    if (query) dbQuery = dbQuery.or(`title.ilike.%${query}%,address.ilike.%${query}%,city.ilike.%${query}%`);

    const { data, count, error } = await dbQuery;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ items: data || [], total: count || 0, page, limit });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
