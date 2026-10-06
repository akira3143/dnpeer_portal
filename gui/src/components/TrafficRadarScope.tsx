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

export const formatBitrate = (bytesPerSec: number): string => {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 bps';
  const bps = bytesPerSec * 8;
  if (bps < 1000) return `${Math.round(bps)} bps`;
  if (bps < 1000 * 1000) return `${(bps / 1000).toFixed(1)} Kbps`;
  if (bps < 1000 * 1000 * 1000) return `${(bps / (1000 * 1000)).toFixed(1)} Mbps`;
  return `${(bps / (1000 * 1000 * 1000)).toFixed(1)} Gbps`;
};

/**
 * Builds a mathematically smooth cubic bezier SVG path across given coordinate points.
 */
function buildSmoothPath(points: Array<{ x: number; y: number }>, height: number = 52): { linePath: string; areaPath: string } {
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
  const scopeHeight = 52;
  const pointCount = 18;

  const { rxPoints, txPoints, healthGlow, peakScaleLabel, hasActiveTraffic } = useMemo(() => {
    const rxPts: Array<{ x: number; y: number }> = [];
    const txPts: Array<{ x: number; y: number }> = [];

    // Derive recent delta rate from series or estimate from volume
    let rateRx = 0;
    let rateTx = 0;

    const numRxBytes = (typeof rxBytes === 'number' && Number.isFinite(rxBytes) && rxBytes > 0) ? rxBytes : 0;
    const numTxBytes = (typeof txBytes === 'number' && Number.isFinite(txBytes) && txBytes > 0) ? txBytes : 0;

    if (Array.isArray(series) && series.length >= 2) {
      const last = series[series.length - 1];
      const prev = series[series.length - 2];
      const lastT = (last && typeof last.t === 'number') ? last.t : 0;
      const prevT = (prev && typeof prev.t === 'number') ? prev.t : 0;
      const dt = (lastT > prevT) ? (lastT - prevT) : 1;

      const lastRx = (last && typeof last.rx === 'number') ? last.rx : 0;
      const prevRx = (prev && typeof prev.rx === 'number') ? prev.rx : 0;
      const lastTx = (last && typeof last.tx === 'number') ? last.tx : 0;
      const prevTx = (prev && typeof prev.tx === 'number') ? prev.tx : 0;

      rateRx = Math.max((lastRx - prevRx) / dt, 0) || 0;
      rateTx = Math.max((lastTx - prevTx) / dt, 0) || 0;
    } else if (numRxBytes > 0 || numTxBytes > 0) {
      rateRx = numRxBytes > 0 ? numRxBytes / 86400 : 0;
      rateTx = numTxBytes > 0 ? numTxBytes / 86400 : 0;
    }

    const hasTraffic = (numRxBytes > 0 || numTxBytes > 0 || rateRx > 0 || rateTx > 0);
    const maxObservedRate = Math.max(rateRx, rateTx, 0) || 0;

    // Noise floor: minimum 1250 bytes/s (10.0 Kbps)
    const scaleCeiling = hasTraffic ? Math.max(maxObservedRate, 1250) : 0;
    const peakLabel = hasTraffic ? formatBitrate(scaleCeiling) : '0 bps';

    // Organic Heartbeat Wave Dynamics (never degenerates into a straight line)
    const baselineY = 44;
    const rateRatio = scaleCeiling > 0 ? Math.min(maxObservedRate / scaleCeiling, 1) : 0;
    // Quiet peers have ~11px subtle ripples; busy peers surge up to 26px
    const amp = hasTraffic ? (10 + (rateRatio || 0) * 16) : 0;

    for (let i = 0; i < pointCount; i++) {
      const u = i / (pointCount - 1);
      const x = u * scopeWidth;

      if (!hasTraffic) {
        // Flat baseline when totally inactive
        rxPts.push({ x, y: 46 });
        txPts.push({ x, y: 46 });
      } else {
        // Multi-harmonic heartbeat / radar waveforms
        const r1 = pseudoHash(sessionId + '_rx', i);
        const t1 = pseudoHash(sessionId + '_tx', i);

        // Rx (Cyan): 2.4 cycles, QRS harmonic systolic notch
        const waveRx = Math.sin(u * Math.PI * 4.8) * 0.45 + Math.sin(u * Math.PI * 9.6) * 0.25 + (r1 - 0.5) * 0.2;
        const normRx = Math.max(0.06, Math.min(0.94, 0.48 + waveRx));

        // Tx (Emerald): 2.1 cycles, phase shifted
        const waveTx = Math.sin(u * Math.PI * 4.2 + 1.2) * 0.45 + Math.cos(u * Math.PI * 8.4) * 0.25 + (t1 - 0.5) * 0.2;
        const normTx = Math.max(0.06, Math.min(0.94, 0.48 + waveTx));

        rxPts.push({ x, y: baselineY - normRx * amp });
        txPts.push({ x, y: baselineY - normTx * (amp * 0.9) });
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

    return {
      rxPoints: rxPts,
      txPoints: txPts,
      healthGlow: glow,
      peakScaleLabel: `▲ ${peakLabel}`,
      hasActiveTraffic: hasTraffic
    };
  }, [rxBytes, txBytes, series, sessionId]);

  const rxPaths = useMemo(() => buildSmoothPath(rxPoints, scopeHeight), [rxPoints]);
  const txPaths = useMemo(() => buildSmoothPath(txPoints, scopeHeight), [txPoints]);

  const lastRx = rxPoints[rxPoints.length - 1] || { x: scopeWidth, y: 46 };
  const lastTx = txPoints[txPoints.length - 1] || { x: scopeWidth, y: 46 };

  const rxGradientId = `rxGrad_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const txGradientId = `txGrad_${sessionId.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <div className="bg-black/40 p-2.5 rounded-lg border border-white/5 space-y-2 relative overflow-hidden group">
      {/* Top row: Metrics Header (Inward Mirroring: [Rx][2.9MB] ... [565KB][Tx]) */}
      <div className="flex items-center justify-between text-xs px-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 text-[9px] uppercase tracking-wider font-sans flex items-center gap-0.5">
            <ArrowDownRight className="w-3 h-3 text-cyan-400" /> Rx Volume
          </span>
          <span className="font-mono text-cyan-300 text-xs font-semibold">
            {formatBytes(rxBytes)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-emerald-300 text-xs font-semibold">
            {formatBytes(txBytes)}
          </span>
          <span className="text-slate-500 text-[9px] uppercase tracking-wider font-sans flex items-center gap-0.5">
            <ArrowUpRight className="w-3 h-3 text-emerald-400" /> Tx Volume
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/5 my-1" />

      {/* Dual Heartbeat Radar Scope */}
      <div className="w-full h-[52px] relative overflow-hidden rounded">
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
          <line x1="0" y1="16" x2={scopeWidth} y2="16" stroke="white" strokeOpacity="0.03" strokeDasharray="3 4" />
          <line x1="0" y1="32" x2={scopeWidth} y2="32" stroke="white" strokeOpacity="0.03" strokeDasharray="3 4" />

          {/* Rx Area & Line (Cyan) */}
          {rxPaths.areaPath && <path d={rxPaths.areaPath} fill={`url(#${rxGradientId})`} />}
          {rxPaths.linePath && (
            <>
              <path
                d={rxPaths.linePath}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="drop-shadow-[0_0_4px_rgba(34,211,238,0.4)]"
              />
              {/* Solitary Real-time Refresh Pulse (Rx Vibrant Cyan flowing Right to Left) */}
              {hasActiveTraffic && (
                <path
                  d={rxPaths.linePath}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="2.0"
                  strokeLinecap="round"
                  strokeDasharray="32 360"
                  className="drop-shadow-[0_0_6px_rgba(6,182,212,0.75)] opacity-85"
                >
                  <animate attributeName="stroke-dashoffset" values="90;482" dur="4.4s" repeatCount="indefinite" />
                </path>
              )}
            </>
          )}

          {/* Tx Area & Line (Emerald) */}
          {txPaths.areaPath && <path d={txPaths.areaPath} fill={`url(#${txGradientId})`} />}
          {txPaths.linePath && (
            <>
              <path
                d={txPaths.linePath}
                fill="none"
                stroke="#34d399"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="drop-shadow-[0_0_4px_rgba(52,211,153,0.4)]"
              />
              {/* Solitary Real-time Refresh Pulse (Tx Vibrant Emerald flowing Right to Left) */}
              {hasActiveTraffic && (
                <path
                  d={txPaths.linePath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.0"
                  strokeLinecap="round"
                  strokeDasharray="32 360"
                  className="drop-shadow-[0_0_6px_rgba(16,185,129,0.75)] opacity-85"
                >
                  <animate attributeName="stroke-dashoffset" values="90;482" dur="5.0s" begin="1.2s" repeatCount="indefinite" />
                </path>
              )}
            </>
          )}

          {/* Sonar Beacon Rings on latest points */}
          {isBgpActive && (
            <>
              <circle cx={lastRx.x} cy={lastRx.y} r="2" fill="none" stroke="#22d3ee" strokeWidth="1">
                <animate attributeName="r" values="2;6;2" dur="4.4s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0;0.85" dur="4.4s" repeatCount="indefinite" />
              </circle>
              <circle cx={lastTx.x} cy={lastTx.y} r="2" fill="none" stroke="#34d399" strokeWidth="1">
                <animate attributeName="r" values="2;6;2" dur="5.0s" begin="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0;0.85" dur="5.0s" begin="1.2s" repeatCount="indefinite" />
              </circle>
            </>
          )}

          {/* Pulse nodes on latest points */}
          <circle cx={lastRx.x} cy={lastRx.y} r="2" fill="#22d3ee" />
          <circle cx={lastTx.x} cy={lastTx.y} r="2" fill="#34d399" />

        </svg>

        {/* HUD Dynamic Scale Overlays (Unified font-mono Engine) */}
        <div className="absolute top-1 right-2 pointer-events-none select-none">
          <span className="font-mono text-[10px] font-semibold text-cyan-300 tracking-tight drop-shadow-[0_0_6px_rgba(6,182,212,0.4)]">
            {peakScaleLabel}
          </span>
        </div>
        <div className="absolute bottom-1 right-2 pointer-events-none select-none">
          <span className="font-mono text-[9px] text-slate-500 font-medium">
            0
          </span>
        </div>
      </div>
    </div>
  );
};
