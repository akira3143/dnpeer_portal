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
  Terminal,
  Copy,
  Download,
  Send,
  FileCode,
  Mail,
  CheckCircle2,
  ChevronDown,
  AlertTriangle,
  Zap,
  Trash2,
  Loader2,
  Settings2,
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
  network,
  user,
  targetNodeId,
  onOpenAuthModal
}) => {
  const { copyToClipboard, showToast } = useToast();

  const [selectedNodeId, setSelectedNodeId] = useState<string>(targetNodeId || nodes[0]?.id || 'JP-TYO-1');
  const [peerName, setPeerName] = useState('');
  const [wgPublicKey, setWgPublicKey] = useState('');
  const [linkLocal, setLinkLocal] = useState('');
  const [ipv4, setIpv4] = useState('');
  const [ipv6Ula, setIpv6Ula] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [bgpMode, setBgpMode] = useState<'mpbgp_enh' | 'dual_stack' | 'ipv6_only'>('mpbgp_enh');
  const [mtu, setMtu] = useState<number>(1420);
  const [customHostPort, setCustomHostPort] = useState('');
  const [customClientPort, setCustomClientPort] = useState('');
  const [isCustomPortExpanded, setIsCustomPortExpanded] = useState(false);
  const [usePeerFallbackPort, setUsePeerFallbackPort] = useState(false);
  const [userNote, setUserNote] = useState('Looking forward to peering! / 期待互联！');

  const [activeTab, setActiveTab] = useState<'wg' | 'bird' | 'markdown'>('wg');
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

  const cleanAsn = user ? String(user.asn) : '';
  const cleanPeerName = peerName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || (cleanAsn ? `AS${cleanAsn.slice(-4)}` : 'peer');

  const selectedNode = useMemo(() => {
    return nodes.find((n) => n.id === selectedNodeId) || nodes[0] || {} as any;
  }, [nodes, selectedNodeId]);

  const networkSlug = (network.shortName || network.networkName || 'peer').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'peer';
  const nodeSlug = (selectedNode.id || selectedNode.code || 'node').toLowerCase().replace(/[^a-z0-9]/g, '_');
  const clientIfaceName = `dn42_${networkSlug}_${nodeSlug}`;

  // Port calculation
  const defaultFormulaPort = useMemo(() => {
    return user?.asn ? calcDefaultPort(user.asn) : 23143;
  }, [user]);

  const finalHostPort = useMemo(() => {
    if (customHostPort && validatePort(customHostPort)) return parseInt(customHostPort, 10);
    return defaultFormulaPort;
  }, [customHostPort, defaultFormulaPort]);

  const finalClientPort = useMemo(() => {
    if (customClientPort && validatePort(customClientPort)) return parseInt(customClientPort, 10);
    if (usePeerFallbackPort) return 33143;
    return defaultFormulaPort;
  }, [customClientPort, usePeerFallbackPort, defaultFormulaPort]);

  const hostPortInfo = useMemo(() => {
    return {
      defaultPort: defaultFormulaPort,
      isFallback: finalHostPort !== defaultFormulaPort,
      label: finalHostPort !== defaultFormulaPort ? 'Custom Port Override' : 'Formula Default Allocated'
    };
  }, [defaultFormulaPort, finalHostPort]);

  // Real-time Validations using SSOT rules.js
  const pubKeyValid = useMemo(() => !wgPublicKey || validatePublicKey(wgPublicKey), [wgPublicKey]);
  const llaValid = useMemo(() => !linkLocal || validateLinkLocal(linkLocal), [linkLocal]);
  const ipv4Valid = useMemo(() => !ipv4 || validateIpv4(ipv4), [ipv4]);
  const ulaValid = useMemo(() => !ipv6Ula || validateIpv6Ula(ipv6Ula), [ipv6Ula]);
  const endpointValid = useMemo(() => !endpoint || validateEndpoint(endpoint), [endpoint]);
  const customHostPortValid = useMemo(() => !customHostPort || validatePort(customHostPort), [customHostPort]);
  const customClientPortValid = useMemo(() => !customClientPort || validatePort(customClientPort), [customClientPort]);
  const mtuValid = useMemo(() => validateMtu(mtu), [mtu]);

  const isFormReady = useMemo(() => {
    return (
      user &&
      wgPublicKey.trim().length === 44 &&
      pubKeyValid &&
      (!linkLocal || llaValid) &&
      (!ipv4 || ipv4Valid) &&
      (!ipv6Ula || ulaValid) &&
      (!endpoint || endpointValid) &&
      customHostPortValid &&
      customClientPortValid &&
      mtuValid
    );
  }, [user, wgPublicKey, pubKeyValid, linkLocal, llaValid, ipv4, ipv4Valid, ipv6Ula, ulaValid, endpoint, endpointValid, customHostPortValid, customClientPortValid, mtuValid]);

  // Generated Client Configurations (Preview)
  const generatedClientWgConfig = useMemo(() => {
    const effectiveLLA = linkLocal.trim() || (cleanAsn ? `fe80::${cleanAsn.slice(-4)}` : '<YOUR_IPV6_LLA>');
    const addressList = [`${effectiveLLA}/64`];
    if (ipv6Ula.trim()) addressList.push(`${ipv6Ula.trim()}/128`);
    if (ipv4.trim()) addressList.push(`${ipv4.trim()}/32`);
    const addressLine = `Address = ${addressList.join(', ')}`;

    const postUpLines: string[] = [];
    if (ipv4.trim() && selectedNode.tunnelIpv4) {
      postUpLines.push(`PostUp = ip addr del dev %i ${ipv4.trim()}/32`);
      postUpLines.push(`PostUp = ip addr add dev %i ${ipv4.trim()}/32 peer ${selectedNode.tunnelIpv4}/32`);
    }
    if (ipv6Ula.trim() && selectedNode.tunnelIpv6ULA) {
      postUpLines.push(`PostUp = ip addr del dev %i ${ipv6Ula.trim()}/128`);
      postUpLines.push(`PostUp = ip addr add dev %i ${ipv6Ula.trim()}/128 peer ${selectedNode.tunnelIpv6ULA}/128`);
    }
    const postUpBlock = postUpLines.length > 0 ? `${postUpLines.join('\n')}\n` : '';

    return `[Interface]
PrivateKey = <YOUR_PRIVATE_KEY>
ListenPort = ${finalClientPort}
${addressLine}
${postUpBlock}MTU = ${mtu}

[Peer]
PublicKey = ${selectedNode.wgPublicKey}
Endpoint = ${selectedNode.endpointDomain}:${finalHostPort}
AllowedIPs = 10.0.0.0/8, 172.20.0.0/14, 172.31.0.0/16, fd00::/8, fe80::/64
PersistentKeepalive = 25`.trim();
  }, [linkLocal, cleanAsn, ipv6Ula, ipv4, selectedNode, finalClientPort, mtu, finalHostPort]);

  const generatedBirdConfig = useMemo(() => {
    const referenceComment = '# Reference only: Adjust template names and filter definitions for your local bird.conf\n';
    const peerAsnNumber = network.asnNumber || 4242423143;

    if (bgpMode === 'mpbgp_enh') {
      return `${referenceComment}protocol bgp ${clientIfaceName} from dnpeers {
    neighbor ${selectedNode.tunnelIpv6LLA}%${clientIfaceName} as ${peerAsnNumber};

    ipv4 {
        extended next hop on;
        import filter dn42_import_filter;
        export filter dn42_export_filter;
    };

    ipv6 {
        import filter dn42_import_filter;
        export filter dn42_export_filter;
    };
}`.trim();
    } else if (bgpMode === 'dual_stack') {
      return `${referenceComment}protocol bgp ${clientIfaceName}_v6 from dnpeers {
    neighbor ${selectedNode.tunnelIpv6LLA}%${clientIfaceName} as ${peerAsnNumber};
    ipv6 {
        import filter dn42_import_filter;
        export filter dn42_export_filter;
    };
}

protocol bgp ${clientIfaceName}_v4 from dnpeers {
    neighbor ${selectedNode.tunnelIpv4 || '172.20.0.x'} as ${peerAsnNumber};
    ipv4 {
        import filter dn42_import_filter;
        export filter dn42_export_filter;
    };
}`.trim();
    } else {
      return `${referenceComment}protocol bgp ${clientIfaceName}_v6 from dnpeers {
    neighbor ${selectedNode.tunnelIpv6LLA}%${clientIfaceName} as ${peerAsnNumber};
    ipv6 {
        import filter dn42_import_filter;
        export filter dn42_export_filter;
    };
}`.trim();
    }
  }, [bgpMode, clientIfaceName, selectedNode, network.asnNumber]);

  const fullCombinedMarkdown = useMemo(() => {
    const effectiveLLA = linkLocal.trim() || (cleanAsn ? `fe80::${cleanAsn.slice(-4)}` : '(Unspecified)');
    const ulaLine = ipv6Ula.trim() ? `- **Your IPv6 ULA:** \`${ipv6Ula.trim()}\`\n` : '';
    const ipv4Line = ipv4.trim() ? `- **Your IPv4 P2P:** \`${ipv4.trim()}\`\n` : '';
    const protocolDesc =
      bgpMode === 'mpbgp_enh'
        ? 'MP-BGP + Extended Next Hop (ENH)'
        : bgpMode === 'dual_stack'
        ? 'Dual-Stack (Independent Sessions)'
        : 'IPv6-Only';

    return `### 🌐 DN42 Peering Request

> **Applicant ASN:** ${cleanAsn ? `AS${cleanAsn}` : '(Unspecified)'}
> **Peer Identifier (Name):** ${cleanPeerName}
> **Target Node:** ${selectedNode.flag || '🌐'} ${selectedNode.name} (${selectedNode.id})

#### 📡 Peering Parameters
- **Your ASN:** ${cleanAsn ? `AS${cleanAsn}` : '(Unspecified)'}
- **Peer Name:** ${cleanPeerName}
- **${network.networkName} Node Endpoint:** \`${selectedNode.endpointDomain}:${finalHostPort}\`
- **Your Public Endpoint:** \`${endpoint ? `${endpoint}:${finalClientPort}` : 'N/A (Behind NAT)'}\`
- **Your WireGuard Public Key:** \`${wgPublicKey.trim() || '(Unspecified)'}\`
- **Your IPv6 Link-Local (LLA):** \`${effectiveLLA}\`
${ulaLine}${ipv4Line}- **BGP Session Mode:** ${protocolDesc}
- **Recommended MTU:** ${mtu}

#### 💬 Additional Note (Optional)
${userNote.trim() || '(No additional notes)'}`.trim();
  }, [cleanAsn, cleanPeerName, selectedNode, finalHostPort, endpoint, finalClientPort, wgPublicKey, linkLocal, ipv6Ula, ipv4, bgpMode, mtu, network.networkName, userNote]);

  const currentOutputCode = useMemo(() => {
    if (submitResult?.configs?.clientWireguard || submitResult?.clientWireguard) {
      if (activeTab === 'wg') return submitResult.configs?.clientWireguard || submitResult.clientWireguard;
    }
    switch (activeTab) {
      case 'wg':
        return generatedClientWgConfig;
      case 'bird':
        return generatedBirdConfig;
      case 'markdown':
        return fullCombinedMarkdown;
      default:
        return '';
    }
  }, [activeTab, submitResult, generatedClientWgConfig, generatedBirdConfig, fullCombinedMarkdown]);

  const handleFillDemoData = () => {
    setPeerName('DemoPeer');
    setEndpoint('peer.example.dn42');
    setWgPublicKey('yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=');
    setLinkLocal(`fe80::${cleanAsn ? cleanAsn.slice(-4) : '3143'}`);
    setIpv6Ula('fd00:4242:3143::1');
    setIpv4('172.20.150.1');
    showToast('Filled standard DN42 demo parameters', 'info');
  };

  const handleClearForm = () => {
    setPeerName('');
    setEndpoint('');
    setWgPublicKey('');
    setIpv6Ula('');
    setIpv4('');
    setCustomHostPort('');
    setCustomClientPort('');
    setUsePeerFallbackPort(false);
    setUserNote('Looking forward to peering! / 期待互联！');
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
        listenPort: customHostPort.trim() || 'auto',
        clientPort: customClientPort.trim() || (usePeerFallbackPort ? '33143' : 'auto'),
        mtu: mtu || 1420,
        bgpMode: bgpMode
      };

      const res = await ApiClient.submitPeering(payload);

      if (res.success && res.data) {
        setSubmitResult(res.data);
        setActiveTab('wg');
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

  const handleDownload = () => {
    const filenames: Record<string, string> = {
      wg: `${clientIfaceName}.conf`,
      bird: `bird_${clientIfaceName}.conf`,
      markdown: `dn42_peering_request_${cleanAsn || 'peer'}.md`
    };
    const filename = filenames[activeTab] || 'config.txt';
    const blob = new Blob([currentOutputCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}`, 'success');
  };

  const handleCopyCurrent = () => {
    copyToClipboard(currentOutputCode, `[${activeTab.toUpperCase()}] Config`);
  };

  // ----------------- 7.2 Login Guard -----------------
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
                LIVE CONFIG ENGINE &middot; <span className="text-slate-500 font-sans">Client Configs & Instant Submission</span>
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
          
          {/* Left Panel: Form Input Fields */}
          <div className="w-full lg:w-[45.45%] shrink-0 rounded-2xl bg-[#080d1a]/85 border border-cyan-500/20 backdrop-blur-xl p-5 sm:p-6 lg:p-7 flex flex-col justify-between shadow-2xl shadow-black/60 relative">
            
            {/* Form Top Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3.5 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <h3 className="font-bold text-white text-sm sm:text-base font-sans tracking-wide">
                  Peering Parameters &middot; <span className="text-slate-400 font-normal text-xs">互联参数</span>
                </h3>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleFillDemoData}
                  type="button"
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[11px] font-sans flex items-center gap-1 transition-all cursor-pointer font-medium"
                  title="Fill test demo data"
                >
                  <Zap className="w-3 h-3 text-cyan-400" />
                  <span>Demo</span>
                </button>
                {(peerName || endpoint || wgPublicKey || ipv6Ula || ipv4 || customHostPort || customClientPort) && (
                  <button
                    onClick={handleClearForm}
                    type="button"
                    className="px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/20 text-slate-400 hover:text-red-300 border border-white/10 hover:border-red-500/30 text-[11px] font-sans transition-all cursor-pointer"
                    title="Clear all fields"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Form Fields Stack */}
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

              {/* 2. Peer ASN & Peer Name in 2 Columns */}
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Peer ASN */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5">
                        <label className="text-slate-300 font-medium">
                          Your ASN &middot; <span className="text-slate-500 text-[11px]">本端 ASN</span>
                        </label>
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-950/80 border border-emerald-500/40 text-[9px] font-mono text-emerald-300">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          <span>Verified</span>
                        </span>
                      </div>
                      
                      {/* Dynamic Port Badge */}
                      <button
                        type="button"
                        onClick={() => setIsCustomPortExpanded(!isCustomPortExpanded)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border flex items-center gap-1 cursor-pointer transition-all ${
                          hostPortInfo.isFallback
                            ? 'text-amber-300 bg-amber-950/80 border-amber-500/50 hover:bg-amber-900/80'
                            : 'text-cyan-300 bg-cyan-950/60 border-cyan-500/30 hover:bg-cyan-900/60'
                        }`}
                        title="View port rules and customization"
                      >
                        <span>{hostPortInfo.isFallback ? `⚡ Fallback: ${finalHostPort}` : `Port: ${finalHostPort}`}</span>
                        <Settings2 className="w-2.5 h-2.5 opacity-70" />
                      </button>
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

                  {/* Peer Name / Identifier */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <label className="text-slate-300 font-medium">
                        Peer Identifier &middot; <span className="text-slate-500 text-[11px]">对端标识</span>
                      </label>
                    </div>
                    <div className="flex items-center w-full rounded-xl bg-[#040813] border border-white/15 focus-within:border-cyan-400 transition-colors overflow-hidden shadow-inner">
                      <input
                        type="text"
                        translate="no"
                        value={peerName}
                        onChange={(e) => setPeerName(e.target.value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12))}
                        placeholder="e.g. USER"
                        maxLength={12}
                        className="notranslate flex-1 px-3.5 py-3 bg-transparent border-0 text-slate-100 font-mono text-xs focus:outline-none placeholder:text-slate-600"
                      />
                    </div>
                    <div translate="no" className="notranslate text-[10px] text-slate-500 pl-1 font-mono truncate">
                      Interface: dn42_{cleanPeerName}_{nodeSlug}
                    </div>
                  </div>
                </div>

                {/* Collapsible Advanced Port & Conflict Inspector */}
                {isCustomPortExpanded && (
                  <div className="p-3.5 rounded-xl bg-black/50 border border-cyan-500/30 space-y-2.5 transition-all">
                    <div className="flex items-center justify-between text-xs font-semibold text-cyan-300">
                      <span className="flex items-center gap-1.5 font-mono">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                        Port Resolution & Conflict Inspector
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsCustomPortExpanded(false)}
                        className="text-slate-400 hover:text-white text-[11px] cursor-pointer"
                      >
                        Close ✕
                      </button>
                    </div>

                    <div className="text-[11px] space-y-1.5 text-slate-300 font-sans">
                      <div translate="no" className="notranslate flex items-center justify-between font-mono bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-slate-400">Formula Listen:</span>
                        <span className="text-cyan-300">20000 + ({cleanAsn || '0'} % 10000) = {hostPortInfo.defaultPort}</span>
                      </div>
                      
                      <div className="flex items-center justify-between font-mono bg-white/[0.03] p-2 rounded-lg border border-white/5">
                        <span className="text-slate-400">Status:</span>
                        <span className={hostPortInfo.isFallback ? 'text-amber-300 font-semibold' : 'text-emerald-400 font-semibold'}>
                          {hostPortInfo.label}
                        </span>
                      </div>
                    </div>

                    {/* Custom Port Override */}
                    <div className="space-y-1">
                      <label className="text-[11px] text-slate-400 flex items-center justify-between px-1.5">
                        <span>Custom Listen Port (10000~65535):</span>
                        {customHostPort && (
                          <button
                            type="button"
                            onClick={() => setCustomHostPort('')}
                            className="text-[10px] text-cyan-400 hover:underline cursor-pointer"
                          >
                            Reset to Formula
                          </button>
                        )}
                      </label>
                      <input
                        type="number"
                        min={10000}
                        max={65535}
                        translate="no"
                        value={customHostPort}
                        onChange={(e) => setCustomHostPort(e.target.value)}
                        placeholder={`Default Port: ${hostPortInfo.defaultPort}`}
                        className="notranslate w-full px-3 py-2 rounded-lg bg-[#040813] border border-white/15 focus:border-cyan-400 text-slate-100 font-mono text-xs focus:outline-none placeholder:text-slate-600"
                      />
                    </div>

                    {/* Custom Peer / Client Port Override */}
                    <div className="pt-2 border-t border-white/10 space-y-1">
                      <label className="text-[11px] text-slate-400 flex items-center justify-between px-1.5">
                        <span>Custom Peer Port / 对端端口 (10000~65535):</span>
                        {customClientPort && (
                          <button
                            type="button"
                            onClick={() => setCustomClientPort('')}
                            className="text-[10px] text-purple-400 hover:underline cursor-pointer"
                          >
                            Reset to Default ({defaultFormulaPort})
                          </button>
                        )}
                      </label>
                      <input
                        type="number"
                        min={10000}
                        max={65535}
                        translate="no"
                        value={customClientPort}
                        onChange={(e) => setCustomClientPort(e.target.value)}
                        placeholder={`Default Port: ${defaultFormulaPort}`}
                        className="notranslate w-full px-3 py-2 rounded-lg bg-[#040813] border border-white/15 focus:border-purple-400 text-slate-100 font-mono text-xs focus:outline-none placeholder:text-slate-600"
                      />
                      <div className="flex items-center justify-between pt-1 px-1">
                        <div className="text-[11px] text-slate-300">
                          Active Peer Port: <span translate="no" className="notranslate font-mono text-purple-300 font-semibold">{finalClientPort}</span>
                        </div>
                        <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-mono text-slate-400 select-none">
                          <input
                            type="checkbox"
                            checked={usePeerFallbackPort}
                            onChange={(e) => {
                              setUsePeerFallbackPort(e.target.checked);
                              setCustomClientPort('');
                            }}
                            className="rounded border-white/20 bg-black/40 text-purple-500 focus:ring-purple-500"
                          />
                          <span>Fallback (33143)</span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 3. WireGuard Public Key */}
              <div className="space-y-1.5">
                <label className="block text-slate-300 font-medium pl-1">
                  WireGuard Public Key <span className="text-cyan-400">*</span> &middot; <span className="text-slate-500 text-[11px]">客户端公钥</span>
                </label>
                <input
                  type="text"
                  translate="no"
                  value={wgPublicKey}
                  onChange={(e) => setWgPublicKey(e.target.value)}
                  placeholder="base64 44-char public key"
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
                  placeholder={`fe80::${cleanAsn ? cleanAsn.slice(-4) : 'xxxx'}`}
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

              {/* 6. WireGuard Endpoint Host */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <label className="text-slate-300 font-medium">
                    WireGuard Endpoint Host &middot; <span className="text-slate-500 text-[11px]">对端接入点</span>
                  </label>
                  <span className="text-[10px] font-mono text-slate-400">(Optional, leave blank if behind NAT)</span>
                </div>
                
                <div className="flex items-center w-full rounded-xl bg-[#040813] border border-white/15 focus-within:border-cyan-400 transition-colors overflow-hidden shadow-inner">
                  <input
                    type="text"
                    translate="no"
                    value={endpoint}
                    onChange={(e) => setEndpoint(e.target.value.replace(/:\d+$/, ''))}
                    placeholder="node.example.dn42"
                    className="notranslate flex-1 px-3.5 py-3 bg-transparent border-0 text-slate-100 font-mono text-xs focus:outline-none placeholder:text-slate-600"
                  />
                  <div translate="no" className="notranslate px-3.5 py-3 bg-white/[0.04] border-l border-white/10 text-cyan-300 font-mono text-xs font-semibold select-none flex items-center shrink-0">
                    <span>:{finalClientPort}</span>
                  </div>
                </div>
                {(!endpointValid || fieldErrors.endpoint) && (
                  <div className="text-[11px] pl-1 flex items-center gap-1 text-red-400 font-sans">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span>{fieldErrors.endpoint || 'Must be a valid domain or public IPv4/IPv6 address'}</span>
                  </div>
                )}
              </div>

              {/* 7. BGP Mode & MTU in 2 Columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-slate-300 font-medium pl-1">
                    BGP Session Mode &middot; <span className="text-slate-500 text-[11px]">协议模式</span>
                  </label>
                  <div className="relative">
                    <select
                      value={bgpMode}
                      onChange={(e) => setBgpMode(e.target.value as any)}
                      className="w-full pl-3.5 pr-8 py-3 rounded-xl bg-[#040813] border border-white/15 text-slate-100 text-xs font-mono focus:border-cyan-400 focus:outline-none transition-colors cursor-pointer appearance-none shadow-inner"
                    >
                      <option value="mpbgp_enh" className="bg-[#0c1424] text-slate-100 py-2">MP-BGP (Extended Next Hop)</option>
                      <option value="dual_stack" className="bg-[#0c1424] text-slate-100 py-2">Dual-Stack (IPv4 / IPv6)</option>
                      <option value="ipv6_only" className="bg-[#0c1424] text-slate-100 py-2">IPv6-Only</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-slate-400 pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-slate-300 font-medium pl-1">
                    WireGuard MTU &middot; <span className="text-slate-500 text-[11px]">隧道 MTU</span>
                  </label>
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

                <button
                  type="button"
                  onClick={handleClearForm}
                  className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Reset form"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

            </form>
          </div>

          {/* Central Book-Spine Divider */}
          <div className="hidden lg:flex flex-col items-center justify-center shrink-0">
            <div className="w-px h-full bg-gradient-to-b from-cyan-500/40 via-white/20 to-purple-500/40 shadow-[0_0_12px_rgba(6,182,212,0.25)]"></div>
          </div>

          {/* Right Panel: Output Canvas, Live Code Renderer & Sending Actions */}
          <div
            translate="no"
            className="notranslate w-full lg:flex-1 min-w-0 rounded-2xl bg-[#080d1a]/85 border border-cyan-500/20 backdrop-blur-xl flex flex-col justify-between overflow-hidden shadow-2xl shadow-black/60 min-h-[640px] lg:min-h-[720px] xl:min-h-[760px]"
          >
            
            <div className="flex-1 flex flex-col min-h-0">
              {/* Studio Canvas Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 bg-black/50 border-b border-white/10 shrink-0">
                
                {/* 3 Core Tabs */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('wg')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 border cursor-pointer ${
                      activeTab === 'wg'
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/40 font-semibold'
                        : 'bg-white/[0.02] border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <FileCode className="w-4 h-4 text-cyan-400" />
                    <span translate="no" className="notranslate">wg0.conf</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('bird')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 border cursor-pointer ${
                      activeTab === 'bird'
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200 shadow-md shadow-cyan-950/40 font-semibold'
                        : 'bg-white/[0.02] border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <Terminal className="w-4 h-4 text-cyan-400" />
                    <span translate="no" className="notranslate">bird.conf</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('markdown')}
                    className={`px-3.5 py-1.5 rounded-xl text-xs font-mono transition-all flex items-center gap-2 border cursor-pointer ${
                      activeTab === 'markdown'
                        ? 'bg-purple-500/20 border-purple-400 text-purple-200 shadow-md shadow-purple-950/40 font-semibold'
                        : 'bg-white/[0.02] border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    <Mail className="w-4 h-4 text-purple-400" />
                    <span translate="no" className="notranslate">peering_request.md</span>
                  </button>
                </div>

                {/* Copy & Download Actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCopyCurrent}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-cyan-500/20 text-slate-300 hover:text-cyan-300 border border-white/10 hover:border-cyan-500/30 text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Copy current config output"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-purple-500/20 text-slate-300 hover:text-purple-300 border border-white/10 hover:border-purple-500/30 text-xs font-sans flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Download config file"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>

              </div>

              {/* Status Banner when Submitted */}
              {submitResult && (
                <div className="p-4 bg-emerald-950/30 border-b border-emerald-500/30 space-y-2">
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

              {/* Code Viewer Panel */}
              <div className="flex-1 min-h-[420px] relative">
                <CodeViewer
                  code={currentOutputCode}
                  language={activeTab}
                />
              </div>

            </div>

            {/* Bottom Panel Actions */}
            <div className="p-4 bg-black/40 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
              <div className="text-[11px] font-mono text-slate-400">
                <span>Target: </span>
                <span className="text-cyan-300">{selectedNode.endpointDomain}:{finalHostPort}</span>
                <span className="text-slate-600 mx-1">&middot;</span>
                <span>ListenPort: </span>
                <span className="text-purple-300">{finalClientPort}</span>
              </div>

              {submitResult && (
                <button
                  type="button"
                  onClick={() => setSubmitResult(null)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-sans transition-colors cursor-pointer"
                >
                  Edit New Request
                </button>
              )}
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};

