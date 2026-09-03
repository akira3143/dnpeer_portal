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
  formatDefaultLinkLocal
} from '@shared/generated/rules.js';
import {
  Terminal,
  Copy,
  Download,
  Send,
  FileCode,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Loader2,
  ShieldCheck,
  Lock,
  LogIn,
  RotateCcw
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

  // 1. Target Node
  const [selectedNodeId, setSelectedNodeId] = useState<string>(targetNodeId || nodes[0]?.id || '');
  // 3. WireGuard Public Key
  const [wgPublicKey, setWgPublicKey] = useState('');
  // 4. Link-Local IPv6 (LLA)
  const [linkLocal, setLinkLocal] = useState('');
  // 5. IPv6 ULA (Optional) & DN42 IPv4 (Optional)
  const [ipv6Ula, setIpv6Ula] = useState('');
  const [ipv4, setIpv4] = useState('');
  // 6. WireGuard Endpoint Host
  const [endpoint, setEndpoint] = useState('');
  // 7. PeerPort & ListenPort
  const [peerPort, setPeerPort] = useState('auto');
  const [listenPort, setListenPort] = useState('auto');
  // 8. WireGuard MTU
  const [mtu, setMtu] = useState<number>(1420);

  // Submit states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string>('');

  useEffect(() => {
    if (targetNodeId && nodes.some((n) => n.id === targetNodeId)) {
      setSelectedNodeId(targetNodeId);
    } else if (nodes.length > 0 && (!selectedNodeId || !nodes.some((n) => n.id === selectedNodeId))) {
      setSelectedNodeId(nodes[0].id);
    }
  }, [targetNodeId, nodes, selectedNodeId]);

  useEffect(() => {
    if (user?.asn && !linkLocal) {
      setLinkLocal(formatDefaultLinkLocal(user.asn));
    }
  }, [user]);

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || nodes[0] || {} as any;
  }, [nodes, selectedNodeId]);

  // Real-time Validations using rules.js
  const pubKeyValid = useMemo(() => !wgPublicKey || validatePublicKey(wgPublicKey).valid, [wgPublicKey]);
  const llaValid = useMemo(() => !linkLocal || validateLinkLocal(linkLocal).valid, [linkLocal]);
  const ipv4Valid = useMemo(() => !ipv4 || validateIpv4(ipv4, true).valid, [ipv4]);
  const ulaValid = useMemo(() => !ipv6Ula || validateIpv6Ula(ipv6Ula, true).valid, [ipv6Ula]);
  const endpointValid = useMemo(() => !endpoint || validateEndpoint(endpoint, true).valid, [endpoint]);
  const peerPortValid = useMemo(() => !peerPort || peerPort === 'auto' || validatePort(peerPort, true).valid, [peerPort]);
  const listenPortValid = useMemo(() => !listenPort || listenPort === 'auto' || validatePort(listenPort, true).valid, [listenPort]);
  const mtuValid = useMemo(() => validateMtu(mtu).valid, [mtu]);

  const isFormReady = useMemo(() => {
    return (
      Boolean(user) &&
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

  const handleClearForm = () => {
    setWgPublicKey('');
    setIpv6Ula('');
    setIpv4('');
    setEndpoint('');
    setPeerPort('auto');
    setListenPort('auto');
    setMtu(1420);
    if (user?.asn) {
      setLinkLocal(formatDefaultLinkLocal(user.asn));
    }
    setFieldErrors({});
    setGeneralError('');
    showToast('Form cleared', 'info');
  };

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
        listenPort: peerPort.trim() || 'auto',
        clientPort: listenPort.trim() || 'auto',
        mtu: parseInt(String(mtu), 10) || 1420,
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

  const authoritativeWgConfig = submitResult?.configs?.clientWireguard || submitResult?.clientWireguard || '';

  const handleDownload = () => {
    if (!authoritativeWgConfig) return;
    const filename = `wg0_${selectedNodeId.toLowerCase().replace(/-/g, '_')}.conf`;
    const blob = new Blob([authoritativeWgConfig], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}`, 'success');
  };

  const handleCopy = () => {
    if (!authoritativeWgConfig) return;
    copyToClipboard(authoritativeWgConfig, 'WireGuard Config');
  };

  // ----------------- Login Guard -----------------
  if (!user) {
    return (
      <section id="generator" className="w-full py-12 scroll-mt-20">
        <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="glass-panel p-8 sm:p-12 text-center rounded-3xl border border-white/10 shadow-2xl bg-black/40 max-w-2xl mx-auto space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center mx-auto text-cyan-400 shadow-lg shadow-cyan-950/50">
              <Lock className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight font-sans">
                Authentication Required &middot; <span className="text-slate-400 font-normal text-lg">需身份验证</span>
              </h2>
              <p className="text-slate-400 text-sm max-w-md mx-auto leading-relaxed font-sans">
                To request automated BGP peering with AkiLab Global PoP Nodes, please verify your DN42 ASN ownership via SSH signature or sign in with your account password.
              </p>
            </div>

            <button
              onClick={onOpenAuthModal}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In to Request Peering &middot; <span className="text-cyan-100 font-normal text-xs">登录并发起互联</span></span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="generator" className="w-full py-2 scroll-mt-20">
      <div className="w-full max-w-[1440px] mx-auto px-4 sm:px-6">

        {/* Magazine Editorial Step Typography */}
        <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-8 mb-3.5 px-1 select-none">
          {/* Step 1 Typography Header */}
          <div className="w-full lg:w-[45.45%] shrink-0 flex items-center gap-3.5 animate-step-1">
            <div className="flex items-baseline shrink-0">
              <span className="text-3xl sm:text-4xl font-black italic text-cyan-400 font-sans leading-none">
                S
              </span>
              <span className="text-base sm:text-lg font-bold italic text-slate-200 font-sans tracking-wide leading-none ml-0.5">
                tep
              </span>
              <span className="ml-2 text-3xl sm:text-4xl font-black italic tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-cyan-300 via-cyan-400 to-blue-500 font-sans leading-none pr-1 drop-shadow-[0_0_18px_rgba(6,182,212,0.4)]">
                01
              </span>
            </div>

            <div className="flex-1 min-w-0 border-l border-white/15 pl-3.5 space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white font-sans uppercase">
                  Peering Parameters
                </h2>
                <span className="text-[9px] font-mono text-cyan-300 uppercase tracking-widest px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/30">
                  INPUT
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 tracking-wider truncate">
                PARAMETERS SETUP &middot; <span className="text-slate-500 font-sans">Parameters & Port Allocation</span>
              </p>
            </div>
          </div>

          <div className="hidden lg:flex w-px shrink-0 opacity-0"></div>

          {/* Step 2 Typography Header */}
          <div className="w-full lg:flex-1 min-w-0 flex items-center gap-3.5 animate-step-2">
            <div className="flex items-baseline shrink-0">
              <span className="text-3xl sm:text-4xl font-black italic text-purple-400 font-sans leading-none">
                S
              </span>
              <span className="text-base sm:text-lg font-bold italic text-slate-200 font-sans tracking-wide leading-none ml-0.5">
                tep
              </span>
              <span className="ml-2 text-3xl sm:text-4xl font-black italic tracking-tight text-transparent bg-clip-text bg-gradient-to-br from-purple-300 via-purple-400 to-pink-500 font-sans leading-none pr-1 drop-shadow-[0_0_18px_rgba(168,85,247,0.4)]">
                02
              </span>
            </div>

            <div className="flex-1 min-w-0 border-l border-white/15 pl-3.5 space-y-0.5">
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-black tracking-tight text-white font-sans uppercase">
                  Configuration & Output
                </h2>
                <span className="text-[9px] font-mono text-purple-300 uppercase tracking-widest px-1.5 py-0.5 rounded bg-purple-950/60 border border-purple-500/30">
                  OUTPUT & SUBMIT
                </span>
              </div>
              <p className="text-[11px] font-mono text-slate-400 tracking-wider truncate">
                AUTHORITATIVE WIREGUARD CONFIG &middot; <span className="text-slate-500 font-sans">Generated by Server</span>
              </p>
            </div>
          </div>
        </div>

        {/* General Error Banner */}
        {generalError && (
          <div className="p-4 mb-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-3 animate-in fade-in">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
            <span>{generalError}</span>
          </div>
        )}

        {/* Generator Studio Flexbox */}
        <div className="flex flex-col lg:flex-row items-stretch gap-6 lg:gap-8 relative">
          
          {/* Left Panel: Form Input Fields (Exact 8 Fields) */}
          <div className="w-full lg:w-[45.45%] shrink-0 rounded-2xl bg-[#080d1a]/85 border border-cyan-500/20 backdrop-blur-xl p-5 sm:p-6 lg:p-7 flex flex-col justify-between shadow-2xl shadow-black/60 relative">
            
            {/* Form Top Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <h3 className="font-bold text-white text-sm sm:text-base font-sans tracking-wide">
                  Peering Parameters &middot; <span className="text-slate-400 font-normal text-xs">互联参数</span>
                </h3>
              </div>

              {(wgPublicKey || ipv6Ula || ipv4 || endpoint || peerPort !== 'auto' || listenPort !== 'auto') && (
                <button
                  onClick={handleClearForm}
                  type="button"
                  className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-300 border border-white/10 hover:border-red-500/30 text-[11px] font-sans transition-all cursor-pointer flex items-center gap-1"
                  title="Clear all fields"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {/* Form Fields Stack (Exactly 8 fields) */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col justify-between space-y-4 lg:space-y-4.5 text-xs font-sans">
              
              {/* 1. Target Node Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="text-slate-300 font-medium">
                    Target Node &middot; <span className="text-slate-500 text-[11px]">目标节点</span>
                  </label>
                  <span className="text-[11px] font-mono text-cyan-400">{selectedNode.region?.toUpperCase()} &middot; {selectedNode.city}</span>
                </div>
                <div className="relative">
                  <select
                    value={selectedNodeId}
                    onChange={(e) => setSelectedNodeId(e.target.value)}
                    className="w-full pl-3.5 pr-10 py-3 rounded-xl bg-[#040813] border border-white/15 text-slate-100 text-xs font-mono focus:border-cyan-400 focus:outline-none transition-colors cursor-pointer appearance-none shadow-inner"
                  >
                    {nodes.map((node) => (
                      <option key={node.id} value={node.id} className="bg-[#0c1424] text-slate-100 py-2">
                        {node.flag} {node.id} &middot; {node.name} ({node.city})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
                
                {/* Styled Chip Badges */}
                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-[10px] font-mono text-slate-300">
                    <span className="text-slate-500">Host:</span>
                    <code className="text-cyan-300">{selectedNode.endpointDomain}</code>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-[10px] font-mono text-slate-300">
                    <span className="text-slate-500">LLA:</span>
                    <code className="text-purple-300">{selectedNode.tunnelIpv6LLA}</code>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.04] border border-white/10 text-[10px] font-mono text-slate-300">
                    <span className="text-slate-500">v4:</span>
                    <code className="text-slate-300">{selectedNode.tunnelIpv4}</code>
                  </span>
                </div>
              </div>

              {/* 2. Your ASN (Locked) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-1.5">
                    <label className="text-slate-300 font-medium">
                      Your ASN &middot; <span className="text-slate-500 text-[11px]">本端自治域号</span>
                    </label>
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] font-mono text-emerald-300">
                      <ShieldCheck className="w-2.5 h-2.5" />
                      <span>Verified</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center w-full rounded-xl border transition-colors overflow-hidden shadow-inner bg-emerald-950/20 border-emerald-500/40">
                  <span className="px-3 py-3 border-r font-mono text-xs font-semibold select-none flex items-center gap-1 bg-emerald-950/50 border-emerald-500/30 text-emerald-400">
                    <Lock className="w-3 h-3 text-emerald-400" />
                    <span>AS</span>
                  </span>
                  <input
                    type="text"
                    translate="no"
                    value={user.asn}
                    readOnly
                    placeholder="424242xxxx"
                    className="notranslate flex-1 px-3 py-3 bg-transparent border-0 font-mono text-xs focus:outline-none placeholder:text-slate-600 text-emerald-300 font-bold cursor-not-allowed select-all"
                    title="Locked to authenticated ASN."
                  />
                </div>
              </div>

              {/* 3. WireGuard Public Key */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="block text-slate-300 font-medium">
                    WireGuard Public Key <span className="text-cyan-400">*</span> &middot; <span className="text-slate-500 text-[11px]">客户端公钥</span>
                  </label>
                  <span className="text-slate-500 text-[10px] font-mono">44-char base64</span>
                </div>
                <input
                  type="text"
                  translate="no"
                  value={wgPublicKey}
                  onChange={(e) => setWgPublicKey(e.target.value)}
                  placeholder="yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E="
                  className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                    !pubKeyValid || fieldErrors.publicKey
                      ? 'border-red-500/80 text-red-200 focus:border-red-400'
                      : pubKeyValid && wgPublicKey.trim().length === 44
                      ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                      : 'border-white/15 text-slate-100 focus:border-cyan-400'
                  }`}
                />
                {(!pubKeyValid || fieldErrors.publicKey) && (
                  <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{fieldErrors.publicKey || 'Must be a 44-character Base64 WireGuard public key ending with =.'}</span>
                  </div>
                )}
              </div>

              {/* 4. Link-Local IPv6 (LLA) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="text-slate-300 font-medium">
                    Link-Local IPv6 (LLA) &middot; <span className="text-slate-500 text-[11px]">链路本地地址</span>
                  </label>
                  <span className="text-[10px] font-mono text-cyan-400">(fe80::/64)</span>
                </div>
                <input
                  type="text"
                  translate="no"
                  value={linkLocal}
                  onChange={(e) => setLinkLocal(e.target.value)}
                  placeholder={`fe80::${String(user.asn).slice(-4)}`}
                  className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                    !llaValid || fieldErrors.linkLocal
                      ? 'border-red-500/80 text-red-200 focus:border-red-400'
                      : llaValid && linkLocal
                      ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                      : 'border-white/15 text-slate-100 focus:border-cyan-400'
                  }`}
                />
                {(!llaValid || fieldErrors.linkLocal) && (
                  <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{fieldErrors.linkLocal || 'Must be a valid Link-Local IPv6 address starting with fe80:'}</span>
                  </div>
                )}
              </div>

              {/* 5. Optional IPs (ULA & IPv4) in 2 Columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-slate-300 font-medium pl-1">
                    IPv6 ULA (Optional) &middot; <span className="text-slate-500 text-[11px]">互联 ULA</span>
                  </label>
                  <input
                    type="text"
                    translate="no"
                    value={ipv6Ula}
                    onChange={(e) => setIpv6Ula(e.target.value)}
                    placeholder="fd00::xxxx"
                    className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                      !ulaValid || fieldErrors.ipv6Ula
                        ? 'border-red-500/80 text-red-200 focus:border-red-400'
                        : ulaValid && ipv6Ula
                        ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                        : 'border-white/15 text-slate-100 focus:border-cyan-400'
                    }`}
                  />
                  {(!ulaValid || fieldErrors.ipv6Ula) && (
                    <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{fieldErrors.ipv6Ula || 'Must be a valid IPv6 ULA starting with fd00::/8'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-slate-300 font-medium">
                      DN42 IPv4 (Optional) &middot; <span className="text-slate-500 text-[11px]">互联 IPv4</span>
                    </label>
                  </div>
                  <input
                    type="text"
                    translate="no"
                    value={ipv4}
                    onChange={(e) => setIpv4(e.target.value)}
                    placeholder="172.20.x.x"
                    className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                      !ipv4Valid || fieldErrors.ipv4
                        ? 'border-red-500/80 text-red-200 focus:border-red-400'
                        : ipv4Valid && ipv4
                        ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                        : 'border-white/15 text-slate-100 focus:border-cyan-400'
                    }`}
                  />
                  {(!ipv4Valid || fieldErrors.ipv4) && (
                    <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{fieldErrors.ipv4 || 'Must be a valid DN42 IPv4 address in 172.20.0.0/14 or 10.0.0.0/8'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 6. WireGuard Endpoint Host (Pure Hostname, no port suffix) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="text-slate-300 font-medium">
                    WireGuard Endpoint Host &middot; <span className="text-slate-500 text-[11px]">对端接入点</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">(Optional, leave blank if behind NAT)</span>
                </div>
                
                <input
                  type="text"
                  translate="no"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value.replace(/:\d+$/, ''))}
                  placeholder="node.example.dn42"
                  className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                    !endpointValid || fieldErrors.endpoint
                      ? 'border-red-500/80 text-red-200 focus:border-red-400'
                      : endpointValid && endpoint
                      ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                      : 'border-white/15 text-slate-100 focus:border-cyan-400'
                  }`}
                />
                {(!endpointValid || fieldErrors.endpoint) && (
                  <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{fieldErrors.endpoint || 'Must be a valid domain or public IPv4/IPv6 address'}</span>
                  </div>
                )}
              </div>

              {/* 7. PeerPort & ListenPort in 2 Columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-slate-300 font-medium">
                      PeerPort &middot; <span className="text-slate-500 text-[11px]">对端监听端口</span>
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">Default: auto</span>
                  </div>
                  <input
                    type="text"
                    translate="no"
                    value={peerPort}
                    onChange={(e) => setPeerPort(e.target.value)}
                    placeholder="auto"
                    className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                      !peerPortValid || fieldErrors.listenPort
                        ? 'border-red-500/80 text-red-200 focus:border-red-400'
                        : peerPortValid && peerPort && peerPort !== 'auto'
                        ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                        : 'border-white/15 text-slate-100 focus:border-cyan-400'
                    }`}
                  />
                  {(!peerPortValid || fieldErrors.listenPort) && (
                    <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{fieldErrors.listenPort || 'Must be auto or an integer between 20000 and 65535'}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1">
                    <label className="text-slate-300 font-medium">
                      ListenPort &middot; <span className="text-slate-500 text-[11px]">本端监听端口</span>
                    </label>
                    <span className="text-[10px] font-mono text-slate-400">Default: auto</span>
                  </div>
                  <input
                    type="text"
                    translate="no"
                    value={listenPort}
                    onChange={(e) => setListenPort(e.target.value)}
                    placeholder="auto"
                    className={`notranslate w-full px-3.5 py-3 rounded-xl bg-[#040813] border font-mono text-xs focus:outline-none placeholder:text-slate-600 transition-colors shadow-inner ${
                      !listenPortValid || fieldErrors.clientPort
                        ? 'border-red-500/80 text-red-200 focus:border-red-400'
                        : listenPortValid && listenPort && listenPort !== 'auto'
                        ? 'border-emerald-500/50 text-slate-100 focus:border-emerald-400'
                        : 'border-white/15 text-slate-100 focus:border-cyan-400'
                    }`}
                  />
                  {(!listenPortValid || fieldErrors.clientPort) && (
                    <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{fieldErrors.clientPort || 'Must be auto or an integer between 20000 and 65535'}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 8. WireGuard MTU */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="block text-slate-300 font-medium">
                    WireGuard MTU &middot; <span className="text-slate-500 text-[11px]">隧道 MTU</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">Default: 1420</span>
                </div>
                <div className="relative">
                  <select
                    value={mtu}
                    onChange={(e) => setMtu(parseInt(e.target.value, 10))}
                    className="w-full pl-3.5 pr-8 py-3 rounded-xl bg-[#040813] border border-white/15 text-slate-100 text-xs font-mono focus:border-cyan-400 focus:outline-none transition-colors cursor-pointer appearance-none shadow-inner"
                  >
                    <option value={1420} className="bg-[#0c1424] text-slate-100 py-2">1420 (Standard)</option>
                    <option value={1408} className="bg-[#0c1424] text-slate-100 py-2">1408 (PPPoE)</option>
                    <option value={1370} className="bg-[#0c1424] text-slate-100 py-2">1370 (Encapsulated)</option>
                    <option value={1280} className="bg-[#0c1424] text-slate-100 py-2">1280 (Min MTU)</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center gap-3 pt-2">
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
                      <span>Submit Peering Application &middot; <span className="text-cyan-100 font-normal text-xs">提交互联申请</span></span>
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>

          {/* Central Book-Spine Divider */}
          <div className="hidden lg:flex flex-col items-center justify-center shrink-0">
            <div className="w-px h-full bg-gradient-to-b from-cyan-500/40 via-white/20 to-purple-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]"></div>
          </div>

          {/* Right Panel: Output Canvas */}
          <div
            translate="no"
            className="notranslate w-full lg:flex-1 min-w-0 rounded-2xl bg-[#080d1a]/85 border border-cyan-500/20 backdrop-blur-xl flex flex-col justify-between overflow-hidden shadow-2xl shadow-black/60 min-h-[600px] lg:min-h-[660px]"
          >
            
            <div className="flex-1 flex flex-col min-h-0">
              {/* Studio Canvas Header: Single wg0.conf Tab */}
              <div className="flex items-center justify-between gap-2 p-3.5 bg-black/50 border-b border-white/10 shrink-0">
                
                <div className="flex items-center gap-2">
                  <div className="px-3.5 py-1.5 rounded-xl text-xs font-mono flex items-center gap-2 bg-cyan-500/20 border border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/40 font-semibold select-none">
                    <FileCode className="w-4 h-4 text-cyan-400" />
                    <span>wg0.conf</span>
                  </div>
                </div>

                {/* Copy & Download Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopy}
                    disabled={!authoritativeWgConfig}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/30 text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Copy authoritative WireGuard config"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={!authoritativeWgConfig}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-purple-500/20 text-slate-300 hover:text-purple-300 border border-white/10 hover:border-purple-500/30 text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Download config file"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>

              </div>

              {/* Status Banner when Submitted */}
              {submitResult && (
                <div className="p-4 bg-emerald-950/30 border-b border-emerald-500/30 space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-sans">
                    <div className="flex items-center gap-2 text-emerald-400 font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>Peering Application Approved &middot; <span className="text-emerald-300 font-normal">互联申请已成功提交</span></span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-300">
                      Session ID: <strong className="text-white">{submitResult.sessionId}</strong>
                    </span>
                  </div>
                  {submitResult.isShifted && submitResult.conflictMessage && (
                    <div className="p-2 rounded-lg bg-amber-950/50 border border-amber-500/30 text-amber-200 text-[11px] flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span>{submitResult.conflictMessage}</span>
                    </div>
                  )}
                  <p className="text-[11px] text-slate-300">
                    {submitResult.acknowledgement || "Received your peering info. We'll establish the peer with you within 24 hours!"}
                  </p>
                </div>
              )}

              {/* Main Canvas Area: Static Prompt Before Submit, Server Result After Submit */}
              <div className="flex-1 min-h-[380px] relative flex flex-col">
                {authoritativeWgConfig ? (
                  <CodeViewer
                    code={authoritativeWgConfig}
                    language="wg"
                  />
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-black/40 border border-transparent">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-950/40 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 shadow-lg shadow-cyan-950/50">
                      <Terminal className="w-6 h-6" />
                    </div>
                    <h4 className="text-slate-200 font-semibold text-sm mb-1.5 font-sans">
                      WireGuard Configuration
                    </h4>
                    <p className="text-slate-400 text-xs max-w-sm leading-relaxed font-sans">
                      Submit the form to receive your WireGuard configuration generated by the AkiLab authority.
                    </p>
                  </div>
                )}
              </div>

            </div>

            {/* Bottom Panel Actions */}
            {submitResult && (
              <div className="p-4 bg-black/40 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
                <div className="text-[11px] font-mono text-slate-400">
                  <span>Target Node: </span>
                  <span className="text-cyan-300">{selectedNode.endpointDomain}</span>
                </div>

                <button
                  type="button"
                  onClick={() => setSubmitResult(null)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-sans transition-colors cursor-pointer"
                >
                  Edit New Request
                </button>
              </div>
            )}

          </div>

        </div>

      </div>
    </section>
  );
};

