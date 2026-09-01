import React, { useState, useMemo, useEffect } from 'react';
import type { NetworkMeta } from '../api/client';
import { useToast } from './Toast';
import { CountryFlag } from './CountryFlag';
import { Layers, Copy, Terminal } from 'lucide-react';

export type RegionType = 'all' | 'apac' | 'na' | 'eu';

interface NodeGridProps {
  nodes: NetworkMeta['nodes'];
  onSelectNode?: (nodeId: string) => void;
}

export const NodeGrid: React.FC<NodeGridProps> = ({ nodes, onSelectNode }) => {
  const [selectedRegion, setSelectedRegion] = useState<RegionType>('all');
  const [probeStatuses, setProbeStatuses] = useState<Record<string, { online: boolean }>>({});
  const { copyToClipboard } = useToast();

  useEffect(() => {
    let mounted = true;
    const fetchProbe = async () => {
      try {
        const res = await fetch('/api/probe/status');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.probes && mounted) {
            setProbeStatuses(data.probes);
          }
        }
      } catch {}
    };
    fetchProbe();
    const interval = setInterval(fetchProbe, 10000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      return selectedRegion === 'all' || node.region === selectedRegion;
    });
  }, [nodes, selectedRegion]);

  const allRegionTabs: { id: RegionType; label: string; count: number }[] = [
    { id: 'all', label: 'ALL', count: nodes.length },
    { id: 'apac', label: 'APAC', count: nodes.filter((n) => n.region === 'apac').length },
    { id: 'na', label: 'NA', count: nodes.filter((n) => n.region === 'na').length },
    { id: 'eu', label: 'EU', count: nodes.filter((n) => n.region === 'eu').length },
  ];

  const regionTabs = allRegionTabs.filter((tab) => tab.id === 'all' || tab.count > 0);

  return (
    <section id="nodes" className="w-full py-8 scroll-mt-20">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono tracking-widest uppercase mb-1">
              <Layers className="w-4 h-4" />
              <span>PoP Infrastructure &middot; <span className="text-slate-400 font-sans">全球边缘节点</span></span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans">
              Global Edge Nodes
            </h2>
          </div>
        </div>

        {/* Region Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
          {regionTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedRegion(tab.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 border cursor-pointer ${
                selectedRegion === tab.id
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/40 font-semibold'
                  : 'bg-white/[0.02] border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                selectedRegion === tab.id ? 'bg-cyan-400 text-black font-bold' : 'bg-white/10 text-slate-400'
              }`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Table / List View */}
        <div className="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black/20">
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              
              {/* Table Header */}
              <div className="grid grid-cols-[3fr_1.2fr_2.5fr_1fr_1.2fr] items-center px-6 py-3.5 bg-white/[0.02] border-b border-white/[0.06] text-slate-400 text-[11px] uppercase tracking-widest font-sans select-none font-medium">
                <div className="pl-2">NODE &middot; <span className="text-slate-600 font-normal">节点</span></div>
                <div className="text-center">STATUS &middot; <span className="text-slate-600 font-normal">状态</span></div>
                <div className="text-left pl-2">ENDPOINT &middot; <span className="text-slate-600 font-normal">接入端点</span></div>
                <div className="text-center">MTU</div>
                <div className="text-right pr-2">ACTION &middot; <span className="text-slate-600 font-normal">操作</span></div>
              </div>

              {/* Table Body Rows */}
              <div className="font-mono text-xs">
                {filteredNodes.map((node, idx) => {
                  const idClean = String(node.id || '').toLowerCase();
                  const codeClean = String(node.code || '').toLowerCase();
                  const isOnline = Boolean(
                    probeStatuses[node.id]?.online ||
                    probeStatuses[idClean]?.online ||
                    probeStatuses[idClean.replace(/-/g, '')]?.online ||
                    (node.code && (probeStatuses[node.code]?.online || probeStatuses[codeClean]?.online || probeStatuses[codeClean.replace(/-/g, '')]?.online))
                  );
                  return (
                    <div
                      key={node.id}
                      className={`grid grid-cols-[3fr_1.2fr_2.5fr_1fr_1.2fr] items-center px-6 py-4 hover:bg-white/[0.03] transition-all duration-200 group border-b border-white/[0.04] last:border-0 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.01]'}`}
                    >
                      {/* Column 1: Node Name & Code */}
                      <div className="flex items-center gap-3.5 pl-2 min-w-0">
                        <CountryFlag
                          flag={node.flag}
                          code={node.id}
                          country={node.country}
                          city={node.city}
                          className="w-7 h-5 object-cover rounded-[3px] shadow-md border border-white/10 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-sans font-semibold text-sm text-slate-100 group-hover:text-cyan-300 transition-colors truncate">
                            {node.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500 mt-1 flex items-center gap-1.5 truncate">
                            <span className="text-cyan-500 font-medium">{node.id}</span>
                            <span className="text-slate-700">|</span>
                            <span>{node.city}</span>
                            <span className="text-slate-700">|</span>
                            <span>{node.isp}</span>
                          </div>
                        </div>
                      </div>

                      {/* Column 2: Status */}
                      <div className="flex items-center justify-center">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-medium tracking-wide ${
                          isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-rose-400'} ${isOnline ? 'animate-pulse' : ''}`}></span>
                          <span>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
                        </span>
                      </div>

                      {/* Column 3: Endpoint */}
                      <div className="flex items-center justify-start pl-2 gap-2">
                        <code className="truncate text-slate-300 group-hover:text-cyan-200 transition-colors text-xs font-medium" title={node.endpointDomain}>
                          {node.endpointDomain}
                        </code>
                        <button
                          onClick={() => copyToClipboard(node.endpointDomain, 'Endpoint')}
                          className="text-slate-500 hover:text-cyan-300 p-1.5 rounded-md hover:bg-white/10 transition-all cursor-pointer shrink-0 opacity-0 group-hover:opacity-100"
                          title="Copy Endpoint"
                          aria-label="Copy Endpoint"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Column 4: MTU */}
                      <div className="text-center">
                        <span className="font-mono text-slate-400 text-[11px] bg-black/40 px-3 py-1 rounded border border-white/5 inline-block tabular-nums shadow-inner">
                          {node.mtu}
                        </span>
                      </div>

                      {/* Column 5: Action */}
                      <div className="flex items-center justify-end pr-2">
                        <button
                          onClick={() => {
                            if (onSelectNode) onSelectNode(node.id);
                          }}
                          className="bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-400 text-cyan-300 px-4 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition-all shadow-lg shadow-transparent hover:shadow-cyan-500/10"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>Request Peering &middot; <span className="text-cyan-100 font-normal text-[11px]">申请互联</span></span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

            </div>
          </div>
        </div>

      </div>
    </section>
  );
};
