import React, { useMemo } from 'react';
import { ArrowDownRight, ArrowUpRight, Network } from 'lucide-react';

interface TrafficRadarScopeProps {
  rxBytes?: number;
  txBytes?: number;
  series?: Array<{ t: number; rx: number; tx: number }>;
  isPureBgp?: boolean;
  isBgpActive?: boolean;
  sessionId: string;
}

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
};

/**
 * Builds a mathematically smooth cubic bezier SVG path across given coordinate points.
 */
function buildSmoothPath(points: Array<{ x: number; y: number }>, height: number = 36): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: '', areaPath: '' };
  if (points.length === 1) {
    return {
      linePath: `M 0 ${points[0].y.toFixed(1)} L 300 ${points[0].y.toFixed(1)}`,
      areaPath: `M 0 ${points[0].y.toFixed(1)} L 300 ${points[0].y.toFixed(1)} L 300 ${height} L 0 ${height} Z`
    };
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const lastPoint = points[points.length - 1];
  const firstPoint = points[0];
  const areaPath = `${d} L ${lastPoint.x.toFixed(1)} ${height} L ${firstPoint.x.toFixed(1)} ${height} Z`;

  return { linePath: d, areaPath };
}

/**
 * Deterministic pseudo-random float generator based on string seed
 */
function pseudoHash(str: string, index: number): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  const x = Math.sin((h + index * 997)) * 10000;
  return x - Math.floor(x);
}

export const TrafficRadarScope: React.FC<TrafficRadarScopeProps> = ({
  rxBytes = 0,
  txBytes = 0,
  series,
  isPureBgp = false,
  isBgpActive = false,
  sessionId
}) => {
  // If this is a non-WG direct link session (e.g. TYIX, flapalerted)
  if (isPureBgp) {
    return (
      <div className="bg-black/40 p-2.5 rounded-lg border border-white/5 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-slate-500 text-[9px] uppercase tracking-wider font-sans flex items-center gap-1">
            <Network className="w-3 h-3 text-cyan-400" /> Direct Link Telemetry
          </span>
          <span className={`text-[10px] font-mono font-medium ${isBgpActive ? 'text-cyan-400' : 'text-slate-500'}`}>
            {isBgpActive ? 'Direct' : 'Offline'}
          </span>
        </div>
        <p className="text-[11px] font-sans text-slate-400 leading-tight">
          Native L2 / IXP cross-connect &middot; host network routing
        </p>
      </div>
    );
  }

  const scopeWidth = 300;
  const scopeHeight = 36;
  const pointCount = 14;

  const { rxPoints, txPoints, healthGlow } = useMemo(() => {
    const rxPts: Array<{ x: number; y: number }> = [];
    const txPts: Array<{ x: number; y: number }> = [];

    const hasRealSeries = Array.isArray(series) && series.length >= 2;

    if (hasRealSeries) {
      // Extract sequential delta rates from series
      const rxDeltas: number[] = [];
      const txDeltas: number[] = [];
      for (let i = 1; i < series.length; i++) {
        const dt = Math.max(series[i].t - series[i - 1].t, 1);
        rxDeltas.push(Math.max(series[i].rx - series[i - 1].rx, 0) / dt);
        txDeltas.push(Math.max(series[i].tx - series[i - 1].tx, 0) / dt);
      }

      const recentRx = rxDeltas.slice(-pointCount);
      const recentTx = txDeltas.slice(-pointCount);
      const maxVal = Math.max(...recentRx, ...recentTx, 100);

      const count = Math.max(recentRx.length, 2);
      for (let i = 0; i < count; i++) {
        const x = (i / (count - 1)) * scopeWidth;
        const rxNorm = (recentRx[i] || 0) / maxVal;
        const txNorm = (recentTx[i] || 0) / maxVal;

        // Invert Y: 0 top, 36 bottom (margin 4 to 32)
        rxPts.push({ x, y: 32 - rxNorm * 24 });
        txPts.push({ x, y: 32 - txNorm * 24 });
      }
    } else {
      // Natural organic heartbeat synthesis based on volume presence
      const hasTraffic = (rxBytes > 0 || txBytes > 0);
      const baseAmp = hasTraffic ? 1.0 : 0.05;

      for (let i = 0; i < pointCount; i++) {
        const x = (i / (pointCount - 1)) * scopeWidth;
        if (!hasTraffic) {
          // Flat quiet baseline
          rxPts.push({ x, y: 32 });
          txPts.push({ x, y: 32.5 });
        } else {
          // Modulated undulating rhythm
          const r1 = pseudoHash(sessionId + '_rx', i);
          const t1 = pseudoHash(sessionId + '_tx', i);
          const waveRx = Math.sin((i / pointCount) * Math.PI * 2) * 0.4 + r1 * 0.6;
          const waveTx = Math.cos((i / pointCount) * Math.PI * 2.5) * 0.4 + t1 * 0.6;

          rxPts.push({ x, y: 30 - waveRx * 20 * baseAmp });
          txPts.push({ x, y: 30 - waveTx * 18 * baseAmp });
        }
      }
    }

    // Health Glow: Cyan/Emerald when active, Amber when asymmetric, Slate when idle
    let glow = '#06b6d4'; // default cyan
    if (rxBytes === 0 && txBytes === 0) {
      glow = '#64748b'; // slate idle
    } else if (rxBytes > 0 && txBytes === 0) {
      glow = '#f59e0b'; // asymmetric
    } else if (rxBytes === 0 && txBytes > 0) {
      glow = '#f59e0b'; // asymmetric
    } else {
      glow = '#10b981'; // healthy emerald
    }

    return { rxPoints: rxPts, txPoints: txPts, healthGlow: glow };
  }, [rxBytes, txBytes, series, sessionId]);

  const rxPaths = useMemo(() => buildSmoothPath(rxPoints, scopeHeight), [rxPoints]);
  const txPaths = useMemo(() => buildSmoothPath(txPoints, scopeHeight), [txPoints]);

  const lastRx = rxPoints[rxPoints.length - 1] || { x: scopeWidth, y: 32 };
  const lastTx = txPoints[txPoints.length - 1] || { x: scopeWidth, y: 32 };

  const rxGradientId = `rxGrad_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const txGradientId = `txGrad_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <div className="bg-black/40 p-2.5 rounded-lg border border-white/5 space-y-2 relative overflow-hidden group">
      {/* Top row: Metrics Header */}
      <div className="flex items-center justify-between text-xs">
        <div>
          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans mb-0.5 flex items-center gap-1">
            <ArrowDownRight className="w-3 h-3 text-cyan-400" /> Rx Volume
          </span>
          <span className="font-mono text-cyan-300 text-xs font-semibold">
            {formatBytes(rxBytes)}
          </span>
        </div>
        <div className="text-right">
          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans mb-0.5 flex items-center justify-end gap-1">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" /> Tx Volume
          </span>
          <span className="font-mono text-emerald-300 text-xs font-semibold">
            {formatBytes(txBytes)}
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/5 my-1" />

      {/* Dual Heartbeat Radar Scope */}
      <div className="w-full h-9 relative overflow-hidden rounded">
        <svg
          viewBox={`0 0 ${scopeWidth} ${scopeHeight}`}
          className="w-full h-full overflow-visible"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={rxGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={txGradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Background subtle health glow */}
          <rect width={scopeWidth} height={scopeHeight} fill={healthGlow} opacity="0.04" />

          {/* Grid guidelines */}
          <line x1="0" y1="12" x2={scopeWidth} y2="12" stroke="white" strokeOpacity="0.03" strokeDasharray="3 4" />
          <line x1="0" y1="24" x2={scopeWidth} y2="24" stroke="white" strokeOpacity="0.03" strokeDasharray="3 4" />

          {/* Rx Area & Line (Cyan) */}
          {rxPaths.areaPath && <path d={rxPaths.areaPath} fill={`url(#${rxGradientId})`} />}
          {rxPaths.linePath && (
            <path
              d={rxPaths.linePath}
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="drop-shadow-[0_0_4px_rgba(34,211,238,0.4)]"
            />
          )}

          {/* Tx Area & Line (Emerald) */}
          {txPaths.areaPath && <path d={txPaths.areaPath} fill={`url(#${txGradientId})`} />}
          {txPaths.linePath && (
            <path
              d={txPaths.linePath}
              fill="none"
              stroke="#34d399"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="drop-shadow-[0_0_4px_rgba(52,211,153,0.4)]"
            />
          )}

          {/* Pulse nodes on latest points */}
          <circle cx={lastRx.x} cy={lastRx.y} r="2" fill="#22d3ee" />
          <circle cx={lastTx.x} cy={lastTx.y} r="2" fill="#34d399" />
        </svg>
      </div>
    </div>
  );
};
