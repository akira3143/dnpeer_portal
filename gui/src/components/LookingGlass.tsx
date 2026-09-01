import React, { useState, useEffect, useMemo } from 'react';
import type { NetworkMeta } from '../api/client';
import { ApiClient } from '../api/client';
import { useToast } from './Toast';
import {
  Terminal,
  Radio,
  Copy,
  ChevronDown,
  Loader2,
  Play
} from 'lucide-react';

export type LgCommandType = 'route' | 'bgp';

interface LookingGlassProps {
  nodes: NetworkMeta['nodes'];
  networkMeta?: NetworkMeta['network'];
}

export const LookingGlass: React.FC<LookingGlassProps> = ({ nodes, networkMeta: _networkMeta }) => {
  const { copyToClipboard } = useToast();

  const [selectedNodeId, setSelectedNodeId] = useState<string>(nodes[0]?.id || 'JP-TYO-1');
  const [qtype, setQtype] = useState<LgCommandType>('route');
  const [targetInput, setTargetInput] = useState<string>('172.20.150.1');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [output, setOutput] = useState<string>('');
  const [_queryError, setQueryError] = useState<string>('');
  const [ranAt, setRanAt] = useState<number | null>(null);
  const [freshnessLabel, setFreshnessLabel] = useState<string>('');

  useEffect(() => {
    if (nodes.length > 0 && !nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (!ranAt) {
      setFreshnessLabel('');
      return;
    }
    const updateLabel = () => {
      const secs = Math.floor((Date.now() - ranAt) / 1000);
      if (secs <= 1) {
        setFreshnessLabel('ran just now');
      } else {
        setFreshnessLabel(`ran ${secs}s ago`);
      }
    };
    updateLabel();
    const timer = setInterval(updateLabel, 1000);
    return () => clearInterval(timer);
  }, [ranAt]);

  const handleRunQuery = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setQueryError('');

    try {
      const targetParam = qtype === 'route' ? targetInput.trim() : undefined;
      const res = await ApiClient.queryLookingGlass(selectedNodeId, qtype, targetParam);
      
      setRanAt(Date.now());
      if (res.success && res.data) {
        setOutput(res.data.output || '');
        if (res.data.error) {
          setQueryError(res.data.error);
        }
      } else {
        const errMsg = res.error?.message || 'Looking glass query failed';
        setQueryError(errMsg);
        setOutput(`error: ${errMsg}`);
      }
    } catch (err: any) {
      const errMsg = err.message || 'Request failed';
      setQueryError(errMsg);
      setOutput(`error: ${errMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || nodes[0];
  }, [nodes, selectedNodeId]);

  return (
    <section id="looking-glass" className="w-full py-8 scroll-mt-20">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono tracking-widest uppercase mb-1">
              <Radio className="w-4 h-4" />
              <span>BGP Diagnostics &middot; <span className="text-slate-400 font-sans">路由诊断</span></span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans">
              Looking Glass
            </h2>
          </div>
        </div>

        {/* Diagnostic Panel */}
        <div className="glass-panel p-5 sm:p-6 space-y-5 rounded-2xl border border-white/10 shadow-2xl bg-black/30">
          
          {/* Controls Grid */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            
            {/* Target Node Dropdown (4 Cols) */}
            <div className="md:col-span-4 space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>PoP Node</span>
                <span className="text-slate-500 font-mono text-[10px] uppercase">Source</span>
              </label>
              <div className="relative">
                <select
                  value={selectedNodeId}
                  onChange={(e) => setSelectedNodeId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono appearance-none focus:border-cyan-400 focus:outline-none transition-colors pr-10"
                >
                  {nodes.map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name} ({node.id})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Query Command Type (3 Cols) */}
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Command</label>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/40 border border-white/10">
                <button
                  type="button"
                  onClick={() => setQtype('route')}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    qtype === 'route'
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Route lookup
                </button>
                <button
                  type="button"
                  onClick={() => setQtype('bgp')}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    qtype === 'bgp'
                      ? 'bg-cyan-500/20 text-cyan-300 font-semibold border border-cyan-500/30'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  BGP summary
                </button>
              </div>
            </div>

            {/* Target Input (3 Cols, disabled for bgp) */}
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                <span>Target / Prefix</span>
                <span className="text-slate-500 font-mono text-[10px]">IPv4/IPv6/ASN</span>
              </label>
              <input
                type="text"
                value={targetInput}
                disabled={qtype === 'bgp'}
                onChange={(e) => setTargetInput(e.target.value)}
                placeholder={qtype === 'bgp' ? 'All BGP protocols' : 'e.g. 172.20.150.1'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            {/* Execute Button (2 Cols) */}
            <div className="md:col-span-2">
              <button
                type="button"
                onClick={handleRunQuery}
                disabled={isLoading}
                className="btn-primary w-full py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Querying...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Run Query</span>
                  </>
                )}
              </button>
            </div>

          </div>

          {/* Console / Output Window */}
          <div className="rounded-xl bg-black/90 border border-white/10 overflow-hidden shadow-inner flex flex-col font-mono text-xs">
            
            {/* Console Titlebar */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.03] border-b border-white/10 text-[11px] text-slate-400 select-none">
              <div className="flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Console Output</span>
                {selectedNode && (
                  <span className="text-slate-600">[{selectedNode.id}]</span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {freshnessLabel && (
                  <span className="text-slate-500 font-mono">{freshnessLabel}</span>
                )}
                {output && (
                  <button
                    onClick={() => copyToClipboard(output, 'Output')}
                    className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                    title="Copy Output"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Console Output Body */}
            <div className="p-4 overflow-x-auto min-h-[160px] max-h-[400px] leading-relaxed">
              {isLoading ? (
                <div className="flex items-center gap-2 text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                  <span>Connecting to {selectedNodeId} lgproxy daemon...</span>
                </div>
              ) : output ? (
                <pre className="text-slate-200 whitespace-pre font-mono selection:bg-cyan-500/30 selection:text-cyan-200">
                  {output}
                </pre>
              ) : (
                <div className="text-slate-600 italic">
                  Select a node and click "Run Query" to execute live BGP diagnostics.
                </div>
              )}
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};
