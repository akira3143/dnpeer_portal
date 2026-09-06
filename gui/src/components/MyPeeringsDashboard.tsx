import React, { useState, useEffect, useMemo } from 'react';
import type { PeeringSession } from '../api/client';
import { ApiClient } from '../api/client';
import { useToast } from './Toast';
import { CountryFlag } from './CountryFlag';
import {
  Activity,
  RefreshCw,
  Search,
  Trash2,
  Lock,
  LogIn,
  AlertTriangle,
  Server,
  Terminal,
  Loader2,
  Edit3,
  ChevronDown,
  ChevronRight,
  Copy,
  Shield,
  Network,
  Clock,
  ArrowDownRight,
  ArrowUpRight
} from 'lucide-react';

interface MyPeeringsDashboardProps {
  user: { asn: number; asName: string; mnt?: string; role: string } | null;
  onOpenAuthModal: () => void;
  onRequestPeering?: () => void;
  onEditSession?: (session: PeeringSession) => void;
}

export const MyPeeringsDashboard: React.FC<MyPeeringsDashboardProps> = ({
  user,
  onOpenAuthModal,
  onRequestPeering,
  onEditSession
}) => {
  const { showToast, copyToClipboard } = useToast();

  const [sessions, setSessions] = useState<PeeringSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [sessionToDelete, setSessionToDelete] = useState<PeeringSession | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const fetchSessions = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const res = await ApiClient.getSessions();
      if (res.success && res.data) {
        setSessions(res.data);
      } else {
        setSessions([]);
      }
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSessions();
    }
  }, [user]);

  const handleDeleteSession = async () => {
    if (!sessionToDelete) return;
    setIsDeleting(true);
    try {
      const res = await ApiClient.deleteSession(sessionToDelete.id);
      if (res.success) {
        showToast('🗑️ Session revoked successfully, host port released!', 'success');
        setSessionToDelete(null);
        await fetchSessions();
      } else {
        showToast(res.error?.message || 'Failed to delete session', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Delete request failed', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const getStatusBadge = (sess: PeeringSession) => {
    const bgpState = sess.runtime?.bgpState;
    const status = sess.status?.toLowerCase() || '';
    const normBgp = bgpState?.toLowerCase() || '';

    if (status === 'active' || normBgp === 'established') {
      return {
        label: bgpState === 'Established' ? 'BGP: Established' : (sess.runtime?.stageText || 'Operational'),
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        dotClass: 'bg-emerald-400'
      };
    }
    if (status === 'connect' || normBgp === 'connect' || normBgp === 'active') {
      return {
        label: bgpState ? `BGP: ${bgpState}` : 'BGP: Connect',
        badgeClass: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
        dotClass: 'bg-amber-400 animate-pulse'
      };
    }
    if (status === 'idle' || normBgp === 'idle') {
      return {
        label: 'BGP: Idle',
        badgeClass: 'bg-sky-500/10 text-sky-400 border border-sky-500/20',
        dotClass: 'bg-sky-400'
      };
    }
    return {
      label: sess.runtime?.stageText || sess.status || 'Pending',
      badgeClass: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
      dotClass: 'bg-slate-400 animate-pulse'
    };
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const formatHandshake = (timestamp?: number): string => {
    if (!timestamp || timestamp <= 0) return 'Never';
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;
    if (diff < 0 || diff < 10) return 'Just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        !q ||
        s.id.toLowerCase().includes(q) ||
        s.nodeId.toLowerCase().includes(q) ||
        String(s.asn).includes(q) ||
        (s.peering?.endpoint && s.peering.endpoint.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (statusFilter === 'active') {
        return s.status === 'active' || s.runtime?.bgpState === 'Established';
      }
      if (statusFilter === 'pending') {
        return s.status !== 'active' && s.runtime?.bgpState !== 'Established';
      }
      return true;
    });
  }, [sessions, searchQuery, statusFilter]);

  // ----------------- 7.2 Login Guard for Unauthenticated Users -----------------
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
                Sign in with your DN42 ASN credentials or cryptographic SSH key to manage your active peering sessions, view assigned ports, and monitor tunnel status.
              </p>
            </div>

            <button
              onClick={onOpenAuthModal}
              className="btn-primary inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25 cursor-pointer"
            >
              <LogIn className="w-4 h-4" />
              <span>Sign In with DN42 Account</span>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full py-8 scroll-mt-20">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Header Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono tracking-widest uppercase mb-1">
              <Activity className="w-4 h-4" />
              <span>Session Management</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight font-sans flex items-center gap-3">
              <span>My Active Peering Sessions</span>
              <span className="text-xs font-mono font-normal px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                AS{user.asn}
              </span>
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchSessions}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white text-xs font-semibold transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-cyan-400' : ''}`} />
              <span>Refresh</span>
            </button>

            {onRequestPeering && (
              <button
                onClick={onRequestPeering}
                className="btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer shadow-md"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>New Peering</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter / Search Bar */}
        <div className="glass-panel p-4 rounded-2xl border border-white/10 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Node, ID, Endpoint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-900/90 border border-white/10 text-white text-xs font-mono focus:border-cyan-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-black/40 border border-white/10 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              All ({sessions.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'active' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              Operational
            </button>
            <button
              onClick={() => setStatusFilter('pending')}
              className={`px-3 py-1 rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'pending' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400'
              }`}
            >
              Pending
            </button>
          </div>
        </div>

        {/* Sessions List */}
        {isLoading && sessions.length === 0 ? (
          <div className="glass-panel p-12 text-center rounded-2xl border border-white/10 text-slate-400 flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="text-xs">Fetching active peering sessions from AkiLab registry...</span>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="glass-panel p-12 text-center rounded-2xl border border-white/10 text-slate-400 space-y-4">
            <Server className="w-10 h-10 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-slate-300">No Peering Sessions Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              You don't have any peering sessions matching the filter. Request a new peering session with one of our global PoP nodes!
            </p>
            {onRequestPeering && (
              <button
                onClick={onRequestPeering}
                className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Create New Peering</span>
              </button>
            )}
          </div>
        ) : (
          <div className="glass-panel rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black/20">
            <div className="overflow-x-auto">
              <div className="min-w-[1000px]">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/[0.02] text-slate-400 text-[11px] font-sans font-medium uppercase tracking-wider select-none">
                      <th className="py-3.5 pl-4 pr-2 w-[180px]">NODE</th>
                      <th className="py-3.5 px-3 w-[180px]">SESSION ID</th>
                      <th className="py-3.5 px-3 w-[120px]">ASN</th>
                      <th className="py-3.5 px-3 w-[110px]">PEERPORT</th>
                      <th className="py-3.5 px-3 w-[110px]">LISTENPORT</th>
                      <th className="py-3.5 px-3 w-[150px]">TRANSFER</th>
                      <th className="py-3.5 px-3 text-center w-[160px]">STATUS</th>
                      <th className="py-3.5 pl-2 pr-4 text-right w-[100px]">ACTION</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04] text-xs">
                    {filteredSessions.map((sess) => {
                      const hostPort = sess.assigned?.hostPort || sess.peering?.listenPort || 0;
                      const peerPort = (sess.peering?.endpoint && sess.peering.endpoint.includes(':') ? sess.peering.endpoint.split(':').pop() : null) || sess.assigned?.clientPort || sess.peering?.clientPort || 0;
                      const badge = getStatusBadge(sess);
                      const isExpanded = expandedSessions.has(sess.id);

                      const cleanLla = sess.peering?.linkLocal && sess.peering.linkLocal.toLowerCase() !== 'fe80::' && !sess.peering.linkLocal.endsWith('::') ? sess.peering.linkLocal : '';
                      const cleanIpv4 = sess.peering?.ipv4 && sess.peering.ipv4 !== '172.16.0.0' && sess.peering.ipv4 !== '10.0.0.0' && !sess.peering.ipv4.endsWith('.0') ? sess.peering.ipv4 : '';
                      const cleanUla = sess.peering?.ipv6Ula && sess.peering.ipv6Ula.toLowerCase() !== 'fd00::' && !sess.peering.ipv6Ula.endsWith('::') ? sess.peering.ipv6Ula : '';

                      return (
                        <React.Fragment key={sess.id}>
                          <tr
                            onClick={() => toggleExpand(sess.id)}
                            className={`hover:bg-white/[0.04] transition-colors group cursor-pointer ${
                              isExpanded ? 'bg-white/[0.02]' : ''
                            }`}
                          >
                            {/* Column 1: Node */}
                            <td className="py-3.5 pl-4 pr-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleExpand(sess.id);
                                  }}
                                  className="text-slate-500 hover:text-cyan-400 transition-colors cursor-pointer p-0.5"
                                  title={isExpanded ? 'Collapse Details' : 'Expand Details'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <CountryFlag
                                  code={sess.nodeId}
                                  className="w-5 h-3.5 object-cover rounded-[2px] border border-white/10 shrink-0"
                                />
                                <span className="font-semibold text-slate-100 group-hover:text-cyan-300 transition-colors font-sans">
                                  {sess.nodeId}
                                </span>
                              </div>
                            </td>

                            {/* Column 2: Session ID */}
                            <td className="py-3.5 px-3">
                              <div className="flex flex-col">
                                <span className="font-mono text-cyan-400/90 font-medium">
                                  {sess.id}
                                </span>
                                {sess.peering?.interface && sess.peering.interface !== sess.id && (
                                  <span className="text-[10px] font-mono text-slate-500 truncate" title={`Local interface: ${sess.peering.interface}`}>
                                    {sess.peering.interface}
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Column 3: ASN */}
                            <td className="py-3.5 px-3">
                              {sess.asn ? (
                                <span className="font-mono text-slate-200">AS{sess.asn}</span>
                              ) : (
                                <span className="font-mono text-amber-400/80">unknown</span>
                              )}
                            </td>

                            {/* Column 4: PEERPORT (Node WireGuard Port) */}
                            <td className="py-3.5 px-3">
                              <span className="font-mono font-semibold text-cyan-300">
                                {hostPort}
                              </span>
                            </td>

                            {/* Column 5: LISTENPORT (Local Client Port) */}
                            <td className="py-3.5 px-3">
                              <span className="font-mono font-semibold text-slate-300">
                                {peerPort}
                              </span>
                            </td>

                            {/* Column 6: Transfer (Rx / Tx Traffic) */}
                            <td className="py-3.5 px-3">
                              <div className="font-mono text-[11px] flex flex-col gap-0.5">
                                <div className="flex items-center gap-1.5 text-cyan-400 font-medium" title={`Received: ${sess.runtime?.rxBytes || 0} bytes`}>
                                  <ArrowDownRight className="w-3.5 h-3.5 shrink-0" />
                                  <span>{formatBytes(sess.runtime?.rxBytes)}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-emerald-400/80 text-[10px]" title={`Transmitted: ${sess.runtime?.txBytes || 0} bytes`}>
                                  <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
                                  <span>{formatBytes(sess.runtime?.txBytes)}</span>
                                </div>
                              </div>
                            </td>

                            {/* Column 7: Status & Handshake */}
                            <td className="py-3.5 px-3 text-center">
                              <div className="inline-flex flex-col items-center gap-1">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium ${badge.badgeClass}`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                                  <span>{badge.label}</span>
                                </span>
                                <span className="text-[9px] font-mono text-slate-500">
                                  {sess.runtime?.latestHandshake && sess.runtime.latestHandshake > 0 ? (
                                    <span className="text-emerald-400 font-medium">WG Up</span>
                                  ) : (
                                    <span>WG Idle</span>
                                  )}
                                </span>
                              </div>
                            </td>

                            {/* Column 8: Action Buttons */}
                            <td className="py-3.5 pl-2 pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {onEditSession && (
                                  <button
                                    type="button"
                                    onClick={() => onEditSession(sess)}
                                    className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-colors cursor-pointer"
                                    title="Edit or Re-submit Session"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setSessionToDelete(sess)}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
                                  title="Revoke Peering Session"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>

                          {/* Expandable Technical Details Drawer */}
                          {isExpanded && (
                            <tr className="bg-cyan-950/10 border-b border-cyan-500/20">
                              <td colSpan={8} className="p-4 sm:p-5">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
                                  {/* Card 1: Tunnel & Security */}
                                  <div className="bg-black/60 p-4 rounded-xl border border-white/5 space-y-3.5 flex flex-col justify-between shadow-inner">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                        <span className="text-slate-400 text-[10px] font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
                                          <Shield className="w-3.5 h-3.5 text-cyan-400" />
                                          Tunnel & Security
                                        </span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-sans font-medium">
                                          MTU {sess.peering?.mtu || 1420} B
                                        </span>
                                      </div>

                                      <div>
                                        <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                          WireGuard Public Key
                                        </span>
                                        <div className="flex items-center justify-between gap-1.5 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5">
                                          <span className="text-slate-300 font-mono text-[11px] truncate select-all" title={sess.peering?.publicKey || 'N/A'}>
                                            {sess.peering?.publicKey || 'N/A'}
                                          </span>
                                          {sess.peering?.publicKey && (
                                            <button
                                              type="button"
                                              onClick={() => copyToClipboard(sess.peering.publicKey, 'WG PubKey')}
                                              className="p-1 hover:text-cyan-400 text-slate-500 transition-colors cursor-pointer shrink-0"
                                              title="Copy Public Key"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      <div>
                                        <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                          WireGuard Endpoint
                                        </span>
                                        <div className="text-[11px]">
                                          {sess.peering?.endpoint ? (
                                            <span className="inline-block text-cyan-300 font-mono bg-cyan-500/10 px-2.5 py-1 rounded border border-cyan-500/20 max-w-full truncate" title={sess.peering.endpoint}>
                                              {sess.peering.endpoint}
                                            </span>
                                          ) : (
                                            <span className="inline-block text-slate-400 italic bg-white/5 px-2.5 py-1 rounded border border-white/10">
                                              Roaming / Dynamic (None)
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-[10px] text-slate-500 flex items-center justify-between pt-2.5 border-t border-white/5 font-sans">
                                      <span>Interface: <code className="text-slate-300 font-mono">{sess.peering?.interface || sess.id}</code></span>
                                      <span>Created: {new Date(sess.createdAt).toLocaleDateString()}</span>
                                    </div>
                                  </div>

                                  {/* Card 2: DN42 Addressing */}
                                  <div className="bg-black/60 p-4 rounded-xl border border-white/5 space-y-3.5 flex flex-col justify-between shadow-inner">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                        <span className="text-slate-400 text-[10px] font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
                                          <Network className="w-3.5 h-3.5 text-emerald-400" />
                                          DN42 Addressing
                                        </span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-sans font-medium">
                                          MP-BGP ENH
                                        </span>
                                      </div>

                                      <div>
                                        <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                          Link-Local IPv6 (LLA)
                                        </span>
                                        <div className="flex items-center justify-between bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5">
                                          <span className="text-slate-200 font-mono text-[11px] select-all">
                                            {cleanLla || 'N/A'}
                                          </span>
                                          {cleanLla && (
                                            <button
                                              type="button"
                                              onClick={() => copyToClipboard(cleanLla, 'Link-Local IPv6')}
                                              className="p-1 hover:text-cyan-400 text-slate-500 transition-colors cursor-pointer shrink-0"
                                              title="Copy LLA"
                                            >
                                              <Copy className="w-3 h-3" />
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                            DN42 IPv4
                                          </span>
                                          <span className={`block font-mono text-[11px] px-2.5 py-1 rounded border ${
                                            cleanIpv4
                                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                              : 'bg-white/5 text-slate-500 border-white/5'
                                          }`}>
                                            {cleanIpv4 || 'None'}
                                          </span>
                                        </div>
                                        <div>
                                          <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                            IPv6 ULA
                                          </span>
                                          <span
                                            className={`block font-mono text-[11px] px-2.5 py-1 rounded border truncate ${
                                              cleanUla
                                                ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                                                : 'bg-white/5 text-slate-500 border-white/5'
                                            }`}
                                            title={cleanUla || 'None'}
                                          >
                                            {cleanUla || 'None'}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="text-[10px] text-slate-500 pt-2.5 border-t border-white/5 font-sans">
                                      Routing: <span className="text-slate-300">Multiprotocol BGP via IPv6 LLA</span>
                                    </div>
                                  </div>

                                  {/* Card 3: Telemetry & Diagnostics */}
                                  <div className="bg-black/60 p-4 rounded-xl border border-white/5 space-y-3.5 flex flex-col justify-between shadow-inner">
                                    <div className="space-y-3">
                                      <div className="flex items-center justify-between border-b border-white/5 pb-2">
                                        <span className="text-slate-400 text-[10px] font-sans uppercase tracking-wider font-semibold flex items-center gap-1.5">
                                          <Activity className="w-3.5 h-3.5 text-cyan-400" />
                                          Telemetry & Health
                                        </span>
                                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium ${badge.badgeClass}`}>
                                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                                          {badge.label}
                                        </span>
                                      </div>

                                      <div>
                                        <span className="text-slate-500 block text-[10px] uppercase tracking-wider font-sans mb-1">
                                          Latest Handshake
                                        </span>
                                        <div className="flex items-center gap-2 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/5">
                                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                          <span className="font-mono text-[11px] text-slate-200">
                                            {formatHandshake(sess.runtime?.latestHandshake)}
                                          </span>
                                          {sess.runtime?.latestHandshake && sess.runtime.latestHandshake > 0 ? (
                                            <span className="ml-auto text-[10px] text-emerald-400 font-sans font-medium">Active</span>
                                          ) : (
                                            <span className="ml-auto text-[10px] text-slate-500 font-sans">Idle / Waiting</span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="grid grid-cols-2 gap-2">
                                        <div className="bg-black/40 p-2.5 rounded-lg border border-white/5">
                                          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans mb-0.5 flex items-center gap-1">
                                            <ArrowDownRight className="w-3 h-3 text-cyan-400" /> Rx Volume
                                          </span>
                                          <span className="font-mono text-cyan-300 text-xs font-semibold">
                                            {formatBytes(sess.runtime?.rxBytes)}
                                          </span>
                                        </div>
                                        <div className="bg-black/40 p-2.5 rounded-lg border border-white/5">
                                          <span className="text-slate-500 block text-[9px] uppercase tracking-wider font-sans mb-0.5 flex items-center gap-1">
                                            <ArrowUpRight className="w-3 h-3 text-emerald-400" /> Tx Volume
                                          </span>
                                          <span className="font-mono text-emerald-300 text-xs font-semibold">
                                            {formatBytes(sess.runtime?.txBytes)}
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    {sess.runtime?.bgpInfo && sess.runtime.bgpInfo !== sess.runtime.bgpState ? (
                                      <div
                                        className="text-[10px] text-amber-400/90 font-mono bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 truncate"
                                        title={sess.runtime.bgpInfo}
                                      >
                                        BGP Info: {sess.runtime.bgpInfo}
                                      </div>
                                    ) : (
                                      <div className="text-[10px] text-slate-500 pt-2.5 border-t border-white/5 font-sans">
                                        Status: <span className="text-slate-300">{sess.runtime?.stageText || sess.status}</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {sessionToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
            <div className="glass-panel w-full max-w-md p-6 rounded-2xl border border-rose-500/30 shadow-2xl bg-[#090d16]/95 relative text-slate-100 font-sans space-y-4">
              <div className="flex items-center gap-3 text-rose-400">
                <AlertTriangle className="w-6 h-6 shrink-0" />
                <h3 className="text-base font-bold text-white">Revoke Peering Session?</h3>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Are you sure you want to revoke session <code className="font-mono text-cyan-300 font-bold">{sessionToDelete.id}</code> on node <strong className="text-white">{sessionToDelete.nodeId}</strong>? This will release the allocated port and withdraw BIRD route announcements.
              </p>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSessionToDelete(null)}
                  disabled={isDeleting}
                  className="w-1/2 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSession}
                  disabled={isDeleting}
                  className="w-1/2 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors cursor-pointer shadow-lg shadow-rose-900/30 flex items-center justify-center gap-2"
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span>Confirm Revoke</span>
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </section>
  );
};
