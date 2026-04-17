import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ============================================================
//  HEALTH / DASHBOARD DATA ENDPOINT
//  Returns pipeline status, counts, recent logs, chart data
// ============================================================

export async function GET() {
  try {
    // Get counts from each table
    const [yardCount, homeCount, cryptoCount] = await Promise.all([
      supabaseAdmin.from('yard_sales').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('cheap_homes').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('crypto_assets').select('id', { count: 'exact', head: true }),
    ]);

    // Get recent scrape logs
    const { data: recentLogs } = await supabaseAdmin
      .from('scrape_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(20);

    // Get last run per pipeline
    const pipelines = ['yard-sales', 'cheap-homes', 'crypto'];
    const pipelineStatuses = await Promise.all(
      pipelines.map(async (pipeline) => {
        const { data: lastRun } = await supabaseAdmin
          .from('scrape_logs')
          .select('*')
          .eq('pipeline', pipeline)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        return {
          name: pipeline,
          status: lastRun?.status || 'idle',
          lastRun: lastRun?.started_at || null,
          itemsScraped: lastRun?.items_found || 0,
          itemsPushed: lastRun?.items_pushed || 0,
          errors: lastRun?.errors || 0,
        };
      })
    );

    // Build chart data from recent logs (last 24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: chartLogs } = await supabaseAdmin
      .from('scrape_logs')
      .select('pipeline, items_found, started_at')
      .gte('started_at', twentyFourHoursAgo)
      .order('started_at', { ascending: true });

    const chartData = (chartLogs || []).reduce((acc: any[], log) => {
      const time = new Date(log.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      let entry = acc.find((e) => e.time === time);
      if (!entry) {
        entry = { time, yardSales: 0, cheapHomes: 0, crypto: 0 };
        acc.push(entry);
      }
      if (log.pipeline === 'yard-sales') entry.yardSales += log.items_found;
      if (log.pipeline === 'cheap-homes') entry.cheapHomes += log.items_found;
      if (log.pipeline === 'crypto') entry.crypto += log.items_found;
      return acc;
    }, []);

    return NextResponse.json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      counts: {
        yard_sales: yardCount.count || 0,
        cheap_homes: homeCount.count || 0,
        crypto: cryptoCount.count || 0,
      },
      pipelines: pipelineStatuses,
      recentLogs: recentLogs || [],
      chartData,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      error: err.message,
      counts: { yard_sales: 0, cheap_homes: 0, crypto: 0 },
      pipelines: [],
      recentLogs: [],
      chartData: [],
    });
  }
}
