import React, { useState, useEffect, useMemo } from 'react';
import confetti from 'canvas-confetti';
import type { NetworkMeta } from '../api/client';
import { ApiClient } from '../api/client';
import { useToast } from './Toast';
import { CodeViewer } from './CodeViewer';
import {
  validatePublicKey,
  validateIpv4,
  validateEndpoint,
  validateIpv6Ula,
  validateLinkLocal,
  validatePort,
  validateMtu,
  calcDefaultPort,
  formatDefaultLinkLocal
} from '@shared/generated/rules.js';
import {
  Copy,
  Download,
  Send,
  FileCode,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Info,
  Zap,
  RotateCcw,
  Loader2,
  Lock,
  LogIn,
  Settings2
} from 'lucide-react';

interface ConfigGeneratorProps {
  nodes: NetworkMeta['nodes'];
  network: NetworkMeta['network'];
  user: { asn: number; asName: string; role: string } | null;
  targetNodeId?: string;
  onOpenAuthModal: () => void;
}

export const ConfigGenerator: React.FC<ConfigGeneratorProps> = ({
  nodes,
  network: _network,
  user,
  targetNodeId,
  onOpenAuthModal
}) => {
  const { copyToClipboard, showToast } = useToast();

  const [selectedNodeId, setSelectedNodeId] = useState<string>(targetNodeId || nodes[0]?.id || 'JP-TYO-1');
  const [wgPublicKey, setWgPublicKey] = useState('');
  const [linkLocal, setLinkLocal] = useState('');
  const [ipv4, setIpv4] = useState('');
  const [ipv6Ula, setIpv6Ula] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [peerPort, setPeerPort] = useState('auto');
  const [listenPort, setListenPort] = useState('auto');
  const [mtu, setMtu] = useState('1420');
  const [customPortExpanded, setCustomPortExpanded] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string>('');

  useEffect(() => {
    if (targetNodeId && nodes.some((n) => n.id === targetNodeId)) {
      setSelectedNodeId(targetNodeId);
    }
  }, [targetNodeId, nodes]);

  useEffect(() => {
    if (user?.asn && !linkLocal) {
      setLinkLocal(formatDefaultLinkLocal(user.asn));
    }
  }, [user]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || nodes[0] || {} as any;
  }, [nodes, selectedNodeId]);

  // Real-time Validations
  const pubKeyValid = useMemo(() => !wgPublicKey || validatePublicKey(wgPublicKey), [wgPublicKey]);
  const llaValid = useMemo(() => !linkLocal || validateLinkLocal(linkLocal), [linkLocal]);
  const ipv4Valid = useMemo(() => !ipv4 || validateIpv4(ipv4), [ipv4]);
  const ulaValid = useMemo(() => !ipv6Ula || validateIpv6Ula(ipv6Ula), [ipv6Ula]);
  const endpointValid = useMemo(() => !endpoint || validateEndpoint(endpoint), [endpoint]);
  const peerPortValid = useMemo(() => peerPort === 'auto' || validatePort(peerPort), [peerPort]);
  const listenPortValid = useMemo(() => listenPort === 'auto' || validatePort(listenPort), [listenPort]);
  const mtuValid = useMemo(() => validateMtu(mtu), [mtu]);

  const defaultFormulaPort = useMemo(() => {
    return user?.asn ? calcDefaultPort(user.asn) : 23143;
  }, [user]);

  const isFormReady = useMemo(() => {
    return (
      user &&
      wgPublicKey.trim().length === 44 &&
      pubKeyValid &&
      (!linkLocal || llaValid) &&
      (!ipv4 || ipv4Valid) &&
      (!ipv6Ula || ulaValid) &&
      (!endpoint || endpointValid) &&
      peerPortValid &&
      listenPortValid &&
      mtuValid
    );
  }, [user, wgPublicKey, pubKeyValid, linkLocal, llaValid, ipv4, ipv4Valid, ipv6Ula, ulaValid, endpoint, endpointValid, peerPortValid, listenPortValid, mtuValid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      onOpenAuthModal();
      return;
    }

    if (!wgPublicKey.trim()) {
      showToast('WireGuard Public Key is required', 'error');
      return;
    }

    setIsSubmitting(true);
    setFieldErrors({});
    setGeneralError('');

    try {
      const payload = {
        asn: user.asn,
        nodeId: selectedNodeId,
        publicKey: wgPublicKey.trim(),
        linkLocal: linkLocal.trim() || formatDefaultLinkLocal(user.asn),
        ipv4: ipv4.trim(),
        ipv6Ula: ipv6Ula.trim(),
        endpoint: endpoint.trim(),
        listenPort: peerPort.trim(),
        clientPort: listenPort.trim(),
        mtu: parseInt(mtu, 10) || 1420,
        bgpMode: 'mpbgp_enh'
      };

      const res = await ApiClient.submitPeering(payload);

      if (res.success && res.data) {
        setSubmitResult(res.data);
        showToast('🎉 Peering application submitted successfully!', 'success');
        try {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
          });
        } catch {}
      } else {
        setGeneralError(res.error?.message || 'Submission failed');
        if (res.error?.fieldErrors) {
          setFieldErrors(res.error.fieldErrors);
        }
        showToast(res.error?.message || 'Peering application rejected', 'error');
      }
    } catch (err: any) {
      setGeneralError(err.message || 'Network request failed');
      showToast('Network error, please try again', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadWg = () => {
    if (!submitResult?.configs?.clientWireguard && !submitResult?.clientWireguard) return;
    const content = submitResult.configs?.clientWireguard || submitResult.clientWireguard;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wg0_dn42_${selectedNodeId.toLowerCase().replace(/-/g, '_')}.conf`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded wg0.conf', 'success');
  };

  const handleReset = () => {
    setSubmitResult(null);
    setWgPublicKey('');
    setIpv4('');
    setIpv6Ula('');
    setEndpoint('');
    setPeerPort('auto');
    setListenPort('auto');
    setMtu('1420');
    setFieldErrors({});
    setGeneralError('');
    if (user) {
      setLinkLocal(formatDefaultLinkLocal(user.asn));
    }
  };

  // ----------------- 7.2 Login Guard -----------------
  if (!user) {
    return (
      <section className="w-full py-12 scroll-mt-20">
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-panel p-8 sm:p-12 text-center rounded-3xl border border-white/10 shadow-2xl bg-black/40 max-w-2xl mx-auto space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400 shadow-lg shadow-cyan-950/50">
              <Lock className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">
                Authentication Required
              </h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed">
                To request automated BGP peering with AkiLab Global PoP Nodes, please verify your DN42 ASN ownership via SSH signature or sign in with your account password.
              </p>
            </div>

            <button
              onClick={onOpenAuthModal}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In to Request Peering</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full py-8 scroll-mt-20">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono tracking-widest uppercase mb-1">
              <Zap className="w-4 h-4" />
              <span>Peering Studio &middot; <span className="text-slate-400 font-sans">互联申请向导</span></span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans">
              Automated WireGuard + BGP Peering
            </h2>
          </div>
        </div>

        {/* General Error Banner */}
        {generalError && (
          <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-3 animate-in fade-in">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{generalError}</span>
          </div>
        )}

        {/* Main Grid: Form on Left (7 cols), Result / Output on Right (5 cols) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Form (7 Cols) */}
          <div className="lg:col-span-7 glass-panel p-6 sm:p-7 rounded-2xl border border-white/10 shadow-2xl bg-black/30 space-y-5">
            
            <form onSubmit={handleSubmit} className="space-y-4 font-sans text-xs">
              
              {/* Row 1: Target PoP Node & ASN Display */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300">Target PoP Node</label>
                  <div className="relative">
                    <select
                      value={selectedNodeId}
                      onChange={(e) => setSelectedNodeId(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono appearance-none focus:border-cyan-400 focus:outline-none pr-10"
                    >
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} ({n.id})
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>Your DN42 ASN</span>
                    <span className="text-slate-500 font-mono text-[10px]">Authenticated</span>
                  </label>
                  <div className="px-3.5 py-2.5 rounded-xl bg-black/60 border border-white/10 text-cyan-300 font-mono text-xs font-bold flex items-center justify-between">
                    <span>AS{user.asn}</span>
                    <span className="text-slate-500 font-normal text-[10px] truncate max-w-[140px]">{user.asName}</span>
                  </div>
                </div>
              </div>

              {/* WireGuard Public Key (Required) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>WireGuard Public Key <span className="text-cyan-400">*</span></span>
                  <span className="text-slate-500 font-mono text-[10px]">44-char base64 ending with =</span>
                </label>
                <input
                  type="text"
                  placeholder="yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E="
                  value={wgPublicKey}
                  onChange={(e) => setWgPublicKey(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-white text-xs font-mono focus:outline-none transition-colors ${
                    !pubKeyValid || fieldErrors.publicKey ? 'border-rose-500' : 'border-white/10 focus:border-cyan-400'
                  }`}
                />
                {(!pubKeyValid || fieldErrors.publicKey) && (
                  <p className="text-[11px] text-rose-400 font-mono">
                    {fieldErrors.publicKey || 'Must be a valid 44-character Base64 WireGuard public key ending with ='}
                  </p>
                )}
              </div>

              {/* Link-Local IPv6 (LLA) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Link-Local IPv6 (LLA)</span>
                  <span className="text-slate-500 font-mono text-[10px]">fe80::/64</span>
                </label>
                <input
                  type="text"
                  placeholder={`fe80::${String(user.asn).slice(-4)}`}
                  value={linkLocal}
                  onChange={(e) => setLinkLocal(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-white text-xs font-mono focus:outline-none transition-colors ${
                    !llaValid || fieldErrors.linkLocal ? 'border-rose-500' : 'border-white/10 focus:border-cyan-400'
                  }`}
                />
                {(!llaValid || fieldErrors.linkLocal) && (
                  <p className="text-[11px] text-rose-400 font-mono">
                    {fieldErrors.linkLocal || 'Must be a valid Link-Local IPv6 address starting with fe80:'}
                  </p>
                )}
              </div>

              {/* Optional IPv4 & IPv6 ULA */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>DN42 IPv4 (Optional)</span>
                    <span className="text-slate-500 font-mono text-[10px]">172.20.0.0/14</span>
                  </label>
                  <input
                    type="text"
                    placeholder="172.20.150.1"
                    value={ipv4}
                    onChange={(e) => setIpv4(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-white text-xs font-mono focus:outline-none transition-colors ${
                      !ipv4Valid || fieldErrors.ipv4 ? 'border-rose-500' : 'border-white/10 focus:border-cyan-400'
                    }`}
                  />
                  {(!ipv4Valid || fieldErrors.ipv4) && (
                    <p className="text-[11px] text-rose-400 font-mono">
                      {fieldErrors.ipv4 || 'Invalid DN42 IPv4 address'}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                    <span>IPv6 ULA (Optional)</span>
                    <span className="text-slate-500 font-mono text-[10px]">fd00::/8</span>
                  </label>
                  <input
                    type="text"
                    placeholder={`fd00:4242:${String(user.asn).slice(-4)}::1`}
                    value={ipv6Ula}
                    onChange={(e) => setIpv6Ula(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-white text-xs font-mono focus:outline-none transition-colors ${
                      !ulaValid || fieldErrors.ipv6Ula ? 'border-rose-500' : 'border-white/10 focus:border-cyan-400'
                    }`}
                  />
                  {(!ulaValid || fieldErrors.ipv6Ula) && (
                    <p className="text-[11px] text-rose-400 font-mono">
                      {fieldErrors.ipv6Ula || 'Must be a valid IPv6 ULA address in fd00::/8'}
                    </p>
                  )}
                </div>
              </div>

              {/* Endpoint Hostname (Optional) */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>WireGuard Endpoint (Optional)</span>
                  <span className="text-slate-500 font-mono text-[10px]">Domain or Public IP (leave empty if NAT)</span>
                </label>
                <input
                  type="text"
                  placeholder="myhost.example.com"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-900/90 border text-white text-xs font-mono focus:outline-none transition-colors ${
                    !endpointValid || fieldErrors.endpoint ? 'border-rose-500' : 'border-white/10 focus:border-cyan-400'
                  }`}
                />
              </div>

              {/* Port & MTU Settings Accordion */}
              <div className="border border-white/10 rounded-xl p-3 bg-black/40 space-y-3">
                <button
                  type="button"
                  onClick={() => setCustomPortExpanded(!customPortExpanded)}
                  className="w-full flex items-center justify-between text-xs text-slate-300 font-semibold cursor-pointer select-none"
                >
                  <span className="flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Advanced Port & MTU Parameters</span>
                  </span>
                  <span className="text-cyan-400 font-mono text-[11px]">
                    {customPortExpanded ? '▲ Hide' : '▼ Expand (Custom Ports)'}
                  </span>
                </button>

                {customPortExpanded && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/10 animate-in fade-in">
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Peer ListenPort</label>
                      <input
                        type="text"
                        placeholder="auto"
                        value={peerPort}
                        onChange={(e) => setPeerPort(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 block font-mono">auto = {defaultFormulaPort}</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">Your ListenPort</label>
                      <input
                        type="text"
                        placeholder="auto"
                        value={listenPort}
                        onChange={(e) => setListenPort(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 block font-mono">auto = random</span>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400">MTU</label>
                      <input
                        type="text"
                        value={mtu}
                        onChange={(e) => setMtu(e.target.value)}
                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-white/10 text-xs font-mono text-white focus:border-cyan-400 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 block font-mono">1280 - 1500</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-3">
                <button
                  type="submit"
                  disabled={isSubmitting || !isFormReady}
                  className="btn-primary flex-1 py-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Submitting Peering Request...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      <span>Submit Peering Application</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Reset form"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

            </form>
          </div>

          {/* Right Output Area (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            
            {submitResult ? (
              <div className="space-y-4 animate-in fade-in duration-300">
                {/* Result Card */}
                <div className="glass-panel p-5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 shadow-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Peering Approved</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      ID: <strong className="text-white">{submitResult.sessionId}</strong>
                    </span>
                  </div>

                  {submitResult.isShifted && submitResult.conflictMessage && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>{submitResult.conflictMessage}</span>
                    </div>
                  )}

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {submitResult.acknowledgement || "Received your peering info. We'll establish the peer with you within 24 hours!"}
                  </p>
                </div>

                {/* Finished WireGuard Config in CodeViewer */}
                <div className="h-[420px] flex flex-col space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Generated wg0.conf</span>
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(submitResult.configs?.clientWireguard || submitResult.clientWireguard, 'WireGuard Config')}
                        className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-cyan-300 text-xs font-medium transition-colors cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </button>
                      <button
                        onClick={handleDownloadWg}
                        className="btn-primary px-3 py-1 rounded-lg text-xs font-medium cursor-pointer inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-hidden">
                    <CodeViewer
                      code={submitResult.configs?.clientWireguard || submitResult.clientWireguard || '# Configuration pending'}
                      language="wg"
                    />
                  </div>
                </div>
              </div>
            ) : (
              /* Live Template Guide Preview Box */
              <div className="glass-panel p-6 rounded-2xl border border-white/10 bg-black/40 shadow-2xl space-y-4">
                <div className="flex items-center gap-2 text-cyan-400 font-semibold text-sm">
                  <Info className="w-4 h-4" />
                  <span>Peering Configuration Summary</span>
                </div>

                <div className="space-y-3 text-xs font-mono text-slate-300">
                  <div className="p-3 rounded-xl bg-black/60 border border-white/5 space-y-1.5">
                    <div className="flex justify-between text-slate-400">
                      <span>Selected Node:</span>
                      <span className="text-white font-bold">{selectedNode.name || selectedNodeId}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Endpoint Domain:</span>
                      <span className="text-cyan-300">{selectedNode.endpointDomain || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>AkiLab Public Key:</span>
                      <span className="text-slate-200 truncate max-w-[200px]">{selectedNode.wgPublicKey || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Dial Port Formula:</span>
                      <span className="text-amber-300">{defaultFormulaPort}</span>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-slate-300 space-y-2 leading-relaxed">
                    <div className="text-cyan-300 font-semibold font-sans">Multi-Protocol BGP ENH</div>
                    <p className="text-[11px]">
                      Our PoP nodes run BIRD 2 with IPv4/IPv6 MP-BGP Extended Next Hop (ENH) over Link-Local IPv6 peering. Both IPv4 and IPv6 routing sessions operate over a single WireGuard tunnel.
                    </p>
                  </div>
                </div>
              </div>
            )}

          </div>

        </div>

      </div>
    </section>
  );
};
