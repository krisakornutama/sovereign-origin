"use client";
import { useState, useEffect } from 'react';
import HoverCard from '../components/ui/HoverCard';
import Sparkline from '../components/ui/Sparkline';
import Icon from '../components/ui/Icon';

// Simulated live data for demo
const generateTrend = (base: number, variance: number, points: number): number[] => {
  const data: number[] = [];
  let current = base;
  for (let i = 0; i < points; i++) {
    current += (Math.random() - 0.5) * variance;
    current = Math.max(0, current);
    data.push(current);
  }
  return data;
};

const SAMPLE_DATA = {
  battery: { soc: 87, power: 2.4, voltage: 48.2, current: 3.1, trend: generateTrend(85, 3, 20) },
  water: { level: 72, flow: 1.8, tank: 340, rainfall: 0, trend: generateTrend(70, 5, 20) },
  temperature: { value: 28.5, humidity: 65, soil: 42, trend: generateTrend(28, 1.5, 20) },
  security: { smoke: 0, flame: 0, gas: 0, pir: 1, trend: generateTrend(0, 0.5, 20) },
  defcon: { level: 3, threat: 42, trend: generateTrend(40, 8, 20) },
  wealth: { portfolio: 2847500, runway: 18, trend: generateTrend(2800000, 50000, 20) },
};

export default function HoverCardsDemo() {
  const [liveData, setLiveData] = useState(SAMPLE_DATA);

  // Simulate live data updates
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveData(prev => ({
        battery: {
          ...prev.battery,
          soc: Math.min(100, Math.max(0, prev.battery.soc + (Math.random() - 0.5) * 2)),
          power: Math.max(0, prev.battery.power + (Math.random() - 0.5) * 0.3),
          trend: [...prev.battery.trend.slice(1), prev.battery.soc + (Math.random() - 0.5) * 3],
        },
        water: {
          ...prev.water,
          level: Math.min(100, Math.max(0, prev.water.level + (Math.random() - 0.5) * 2)),
          flow: Math.max(0, prev.water.flow + (Math.random() - 0.5) * 0.2),
          trend: [...prev.water.trend.slice(1), prev.water.level + (Math.random() - 0.5) * 3],
        },
        temperature: {
          ...prev.temperature,
          value: Math.max(15, Math.min(45, prev.temperature.value + (Math.random() - 0.5) * 0.5)),
          humidity: Math.min(100, Math.max(0, prev.temperature.humidity + (Math.random() - 0.5) * 2)),
          trend: [...prev.temperature.trend.slice(1), prev.temperature.value + (Math.random() - 0.5) * 1],
        },
        security: {
          ...prev.security,
          pir: Math.random() > 0.7 ? 1 : 0,
          trend: [...prev.security.trend.slice(1), prev.security.pir],
        },
        defcon: {
          ...prev.defcon,
          threat: Math.min(100, Math.max(0, prev.defcon.threat + (Math.random() - 0.5) * 4)),
          trend: [...prev.defcon.trend.slice(1), prev.defcon.threat + (Math.random() - 0.5) * 5],
        },
        wealth: {
          ...prev.wealth,
          portfolio: Math.max(0, prev.wealth.portfolio + (Math.random() - 0.5) * 20000),
          trend: [...prev.wealth.trend.slice(1), prev.wealth.portfolio + (Math.random() - 0.5) * 30000],
        },
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const formatNumber = (n: number) => n.toLocaleString('en-US');
  const formatCurrency = (n: number) => `฿${formatNumber(Math.round(n))}`;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-10">
        <h1 className="text-3xl font-bold text-gray-100 mb-2">
          Hover Cards
          <span className="text-emerald-400 ml-2 text-lg font-normal">Interactive Dashboard Widgets</span>
        </h1>
        <p className="text-gray-400 text-sm max-w-2xl">
          Hover over any card to reveal detailed metrics, sparkline trends, and action buttons.
          Cards flip in 3D (left column) or expand downward (right column) to show dynamic content.
        </p>
      </div>

      {/* Cards Grid */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* ── Flip Cards ── */}
        <HoverCard
          icon={<Icon name="battery" size={20} />}
          title="Battery SOC"
          metric={`${liveData.battery.soc.toFixed(0)}%`}
          accent="emerald"
          status={liveData.battery.soc > 50 ? 'online' : 'warning'}
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Power Output</span>
                <span className="text-gray-200 mono">{liveData.battery.power.toFixed(1)} kW</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Voltage</span>
                <span className="text-gray-200 mono">{liveData.battery.voltage.toFixed(1)} V</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Current</span>
                <span className="text-gray-200 mono">{liveData.battery.current.toFixed(1)} A</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">24h Trend</span>
                <Sparkline data={liveData.battery.trend} color="#10b981" />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">Details</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Optimize</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="droplet" size={20} />}
          title="Water Level"
          metric={`${liveData.water.level.toFixed(0)}%`}
          accent="cyan"
          status={liveData.water.level > 20 ? 'online' : 'critical'}
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Flow Rate</span>
                <span className="text-gray-200 mono">{liveData.water.flow.toFixed(1)} L/min</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Tank Volume</span>
                <span className="text-gray-200 mono">{liveData.water.tank} L</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Rainfall (24h)</span>
                <span className="text-gray-200 mono">{liveData.water.rainfall} mm</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Level Trend</span>
                <Sparkline data={liveData.water.trend} color="#22d3ee" />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">History</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Pump Control</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="thermometer" size={20} />}
          title="Temperature"
          metric={`${liveData.temperature.value.toFixed(1)}°C`}
          accent="amber"
          status={liveData.temperature.value < 35 ? 'online' : 'warning'}
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Humidity</span>
                <span className="text-gray-200 mono">{liveData.temperature.humidity.toFixed(0)}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Soil Moisture</span>
                <span className="text-gray-200 mono">{liveData.temperature.soil.toFixed(0)}%</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Temperature Trend</span>
                <Sparkline data={liveData.temperature.trend} color="#f59e0b" />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">Log</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Fan Control</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="shield" size={20} />}
          title="Security Status"
          metric={liveData.security.pir ? 'Motion Detected' : 'All Clear'}
          accent={liveData.security.pir ? 'red' : 'emerald'}
          status={liveData.security.pir ? 'critical' : 'online'}
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Smoke</span>
                <span className={liveData.security.smoke ? 'text-red-400' : 'text-gray-300'}>
                  {liveData.security.smoke ? 'DETECTED' : 'Clear'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Flame</span>
                <span className={liveData.security.flame ? 'text-red-400' : 'text-gray-300'}>
                  {liveData.security.flame ? 'DETECTED' : 'Clear'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Gas Leak</span>
                <span className={liveData.security.gas ? 'text-red-400' : 'text-gray-300'}>
                  {liveData.security.gas ? 'DETECTED' : 'Clear'}
                </span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Motion Events</span>
                <Sparkline data={liveData.security.trend} color={liveData.security.pir ? '#ef4444' : '#10b981'} />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">Camera</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Arm/Disarm</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="shield" size={20} />}
          title="DEFCON Level"
          metric={`DEFCON ${liveData.defcon.level}`}
          accent={liveData.defcon.level <= 2 ? 'red' : liveData.defcon.level === 3 ? 'amber' : 'emerald'}
          status={liveData.defcon.level <= 2 ? 'critical' : liveData.defcon.level === 3 ? 'warning' : 'online'}
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Threat Index</span>
                <span className="text-gray-200 mono">{liveData.defcon.threat.toFixed(0)}/100</span>
              </div>
              <div className="bg-gray-700 h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-1.5 rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, liveData.defcon.threat)}%`,
                    background: liveData.defcon.threat > 75 ? '#ef4444' : liveData.defcon.threat > 50 ? '#f59e0b' : '#10b981',
                  }}
                />
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Threat Trend</span>
                <Sparkline data={liveData.defcon.trend} color={liveData.defcon.threat > 75 ? '#ef4444' : '#f59e0b'} />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">Report</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Full Monitor</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="portfolio" size={20} />}
          title="Portfolio Value"
          metric={formatCurrency(liveData.wealth.portfolio)}
          accent="violet"
          status="online"
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Survival Runway</span>
                <span className="text-gray-200 mono">{liveData.wealth.runway} months</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Daily Burn</span>
                <span className="text-gray-200 mono">฿{(liveData.wealth.portfolio / (liveData.wealth.runway * 30)).toFixed(0)}/day</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Portfolio Trend</span>
                <Sparkline data={liveData.wealth.trend} color="#a78bfa" />
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">History</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Rebalance</button>
            </>
          }
        />

        {/* ── Expand Cards ── */}
        <HoverCard
          icon={<Icon name="wifi" size={20} />}
          title="Device Status"
          metric="12 Online"
          accent="blue"
          status="online"
          expand
          detail={
            <div className="space-y-1.5">
              {['Node-Alpha', 'Node-Beta', 'Node-Gamma', 'Node-Delta'].map((node, i) => (
                <div key={node} className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{node}</span>
                  <span className={`flex items-center gap-1.5 ${i < 3 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    <span className="relative flex h-1.5 w-1.5">
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${i < 3 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                      <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${i < 3 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    </span>
                    {i < 3 ? 'Online' : 'Degraded'}
                  </span>
                </div>
              ))}
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">Scan</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Configure</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="globe" size={20} />}
          title="Global Map"
          metric="4 Nodes"
          accent="cyan"
          status="online"
          expand
          detail={
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-gray-400">Thailand — 3 nodes</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span className="text-gray-400">Singapore — 1 node</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-gray-400">Japan — 1 node (degraded)</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Latency (ms)</span>
                <div className="flex gap-2 mt-1">
                  {[12, 45, 8, 120].map((latency, i) => (
                    <div key={i} className="flex-1 bg-gray-800 rounded px-2 py-1 text-center">
                      <span className={`text-xs mono ${latency > 100 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {latency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">View Map</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">Add Node</button>
            </>
          }
        />

        <HoverCard
          icon={<Icon name="ai-agent" size={20} />}
          title="AI Agent"
          metric="Active"
          accent="violet"
          status="online"
          expand
          detail={
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Model</span>
                <span className="text-gray-200 mono">Llama 3.1 8B</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Context</span>
                <span className="text-gray-200 mono">4,096 tokens</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-400">Latency</span>
                <span className="text-gray-200 mono">~120ms</span>
              </div>
              <div className="pt-2 border-t border-gray-700/50">
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Recent Queries</span>
                <div className="mt-1 space-y-1">
                  {['Energy optimization', 'Security analysis', 'Weather forecast'].map((q, i) => (
                    <div key={i} className="text-xs text-gray-400 bg-gray-800/50 rounded px-2 py-1 truncate">
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          }
          actions={
            <>
              <button className="btn btn-secondary text-xs px-3 py-1.5">History</button>
              <button className="btn btn-primary text-xs px-3 py-1.5">New Chat</button>
            </>
          }
        />
      </div>

      {/* Legend */}
      <div className="max-w-6xl mx-auto mt-10 flex flex-wrap items-center gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 border border-gray-600 rounded-lg bg-gray-900/60 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <span>Flip Card (3D rotate)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 border border-gray-600 rounded-lg bg-gray-900/60 flex items-center justify-center">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <span>Expand Card (slide down)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span>Live status indicator</span>
        </div>
        <div className="flex items-center gap-2">
          <svg width="40" height="16" viewBox="0 0 40 16" className="overflow-visible">
            <path d="M0,12 Q10,4 20,8 T40,6" fill="none" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Sparkline trend</span>
        </div>
      </div>
    </div>
  );
}
