// FILE: src/app/dashboard/page.tsx
// REPLACES: src/app/dashboard/page.tsx
// CLEANED: Removed cheap-homes and crypto pipelines, pipeConfig, triggerAll, chart, placeholder logs

'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  RefreshCw,
  Play,
  Clock,
  CheckCircle,
  AlertTriangle,
  Tag,
  ArrowUpRight,
  Database,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface PipelineStatus {
  name: string;
  status: 'idle' | 'running' | 'success' | 'error';
  lastRun: string | null;
  itemsScraped: number;
  itemsPushed: number;
  errors: number;
}

interface ScrapeLog {
  id: string;
  pipeline: string;
  status: string;
  items_found: number;
  items_pushed: number;
  errors: number;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export default function DashboardPage() {
  const [pipelines, setPipelines] = useState<PipelineStatus[]>([
    { name: 'yard-sales', status: 'idle', lastRun: null, itemsScraped: 0, itemsPushed: 0, errors: 0 },
  ]);
  const [logs, setLogs] = useState<ScrapeLog[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  // Fetch dashboard data
  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 30000);
    return () => clearInterval(interval);
  }, []);

  async function fetchDashboardData() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        if (data.pipelines) setPipelines(data.pipelines);
        if (data.recentLogs) setLogs(data.recentLogs);
        if (data.chartData) setChartData(data.chartData);
      }
    } catch (err) {
      console.error('Dashboard fetch error:', err);
    }
  }

  async function triggerScrape(pipeline: string) {
    setIsRunning(true);
    setPipelines((prev) =>
      prev.map((p) => (p.name === pipeline ? { ...p, status: 'running' } : p))
    );

    try {
      const res = await fetch(`/api/scrape/${pipeline}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.NEXT_PUBLIC_CITYSCRAPER_API_KEY || '',
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setPipelines((prev) =>
        prev.map((p) =>
          p.name === pipeline
            ? {
                ...p,
                status: data.success ? 'success' : 'error',
                lastRun: new Date().toISOString(),
                itemsScraped: data.itemsFound || 0,
                itemsPushed: data.itemsPushed || 0,
                errors: data.errors || 0,
              }
            : p
        )
      );
    } catch (err) {
      console.error(`[Dashboard] Scrape ${pipeline} failed:`, (err as Error).message);
      setPipelines((prev) =>
        prev.map((p) => (p.name === pipeline ? { ...p, status: 'error' } : p))
      );
    } finally {
      setIsRunning(false);
    }
  }

  const pipeConfig: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    'yard-sales': { icon: <Tag className="w-5 h-5" />, label: 'YardShoppers', color: 'green' },
  };

  const statusColors: Record<string, string> = {
    idle: 'text-matrix-green-dim/50',
    running: 'text-matrix-amber animate-pulse',
    success: 'text-matrix-green',
    error: 'text-matrix-red',
  };

  const statusIcons: Record<string, React.ReactNode> = {
    idle: <Clock className="w-4 h-4" />,
    running: <RefreshCw className="w-4 h-4 animate-spin" />,
    success: <CheckCircle className="w-4 h-4" />,
    error: <AlertTriangle className="w-4 h-4" />,
  };

  return (
    <div className="min-h-screen px-4 py-8 md:px-8 lg:px-16">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-2xl tracking-wider text-glow flex items-center gap-3">
            <Activity className="w-6 h-6 text-matrix-cyan" />
            COMMAND CENTER
          </h1>
          <p className="text-matrix-green-dim/50 terminal-sm mt-1">
            Real-time aggregator monitoring and control
          </p>
        </div>
        <button
          onClick={() => triggerScrape('yard-sales')}
          disabled={isRunning}
          className="neon-btn flex items-center gap-2 disabled:opacity-30"
        >
          <Play className="w-4 h-4" />
          {isRunning ? 'RUNNING...' : 'RUN SCRAPE'}
        </button>
      </div>

      {/* PIPELINE CARDS */}
      <div className="grid md:grid-cols-1 gap-6 mb-10 max-w-lg">
        {pipelines.map((pipe, i) => {
          const cfg = pipeConfig[pipe.name] || { icon: <Tag className="w-5 h-5" />, label: pipe.name, color: 'green' };
          return (
            <motion.div
              key={pipe.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="glass-panel p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-matrix-green">{cfg.icon}</span>
                  <span className="font-display text-xs tracking-wider">{cfg.label}</span>
                </div>
                <span className={`flex items-center gap-1 terminal-xs ${statusColors[pipe.status]}`}>
                  {statusIcons[pipe.status]}
                  {pipe.status.toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div>
                  <p className="terminal-xs text-matrix-green-dim/40">Scraped</p>
                  <p className="text-matrix-green font-bold">{pipe.itemsScraped.toLocaleString()}</p>
                </div>
                <div>
                  <p className="terminal-xs text-matrix-green-dim/40">Pushed</p>
                  <p className="text-matrix-cyan font-bold">{pipe.itemsPushed.toLocaleString()}</p>
                </div>
                <div>
                  <p className="terminal-xs text-matrix-green-dim/40">Errors</p>
                  <p className={`font-bold ${pipe.errors > 0 ? 'text-matrix-red' : 'text-matrix-green-dim/40'}`}>
                    {pipe.errors}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="terminal-xs text-matrix-green-dim/30">
                  {pipe.lastRun ? `Last: ${new Date(pipe.lastRun).toLocaleTimeString()}` : 'Never run'}
                </span>
                <button
                  onClick={() => triggerScrape(pipe.name)}
                  disabled={isRunning}
                  className="neon-btn text-[10px] px-3 py-1 disabled:opacity-30"
                >
                  <Play className="w-3 h-3 inline mr-1" />
                  RUN
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ACTIVITY CHART */}
      <div className="glass-panel p-6 mb-10">
        <h2 className="font-display text-sm tracking-wider text-matrix-green-dim mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-matrix-cyan" />
          SCRAPE VOLUME (24H)
        </h2>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData.length ? chartData : generatePlaceholderChart()}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00ff4110" />
              <XAxis dataKey="time" stroke="#00ff4140" tick={{ fontSize: 10 }} />
              <YAxis stroke="#00ff4140" tick={{ fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: '#0d1b0e',
                  border: '1px solid #00ff4130',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#00ff41',
                }}
              />
              <Area
                type="monotone"
                dataKey="yardSales"
                stroke="#00ff41"
                fill="#00ff4120"
                name="Yard Sales"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* RECENT LOGS */}
      <div className="glass-panel p-6">
        <h2 className="font-display text-sm tracking-wider text-matrix-green-dim mb-4">
          // RECENT SCRAPE LOGS
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full terminal-xs">
            <thead>
              <tr className="text-matrix-green-dim/40 border-b border-matrix-panel-border">
                <th className="text-left py-2 px-2">Pipeline</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-right py-2 px-2">Found</th>
                <th className="text-right py-2 px-2">Pushed</th>
                <th className="text-right py-2 px-2">Errors</th>
                <th className="text-right py-2 px-2">Duration</th>
                <th className="text-right py-2 px-2">Time</th>
              </tr>
            </thead>
            <tbody>
              {(logs.length ? logs : generatePlaceholderLogs()).map((log, i) => (
                <tr
                  key={log.id || i}
                  className="border-b border-matrix-panel-border/30 hover:bg-matrix-green/5"
                >
                  <td className="py-2 px-2 font-display tracking-wider">
                    {pipeConfig[log.pipeline]?.label || log.pipeline}
                  </td>
                  <td
                    className={`py-2 px-2 ${
                      log.status === 'success'
                        ? 'text-matrix-green'
                        : log.status === 'error'
                        ? 'text-matrix-red'
                        : 'text-matrix-amber'
                    }`}
                  >
                    {log.status.toUpperCase()}
                  </td>
                  <td className="py-2 px-2 text-right">{log.items_found}</td>
                  <td className="py-2 px-2 text-right text-matrix-cyan">{log.items_pushed}</td>
                  <td className={`py-2 px-2 text-right ${log.errors > 0 ? 'text-matrix-red' : ''}`}>
                    {log.errors}
                  </td>
                  <td className="py-2 px-2 text-right text-matrix-green-dim/50">
                    {log.duration_ms ? `${(log.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                  <td className="py-2 px-2 text-right text-matrix-green-dim/30">
                    {log.started_at ? new Date(log.started_at).toLocaleTimeString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// Placeholder data for initial render
function generatePlaceholderChart() {
  const hours = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
  return hours.map((time) => ({
    time,
    yardSales: Math.floor(Math.random() * 50),
  }));
}

function generatePlaceholderLogs(): ScrapeLog[] {
  return [
    {
      id: '1',
      pipeline: 'yard-sales',
      status: 'success',
      items_found: 142,
      items_pushed: 138,
      errors: 0,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: 12400,
    },
  ];
}
