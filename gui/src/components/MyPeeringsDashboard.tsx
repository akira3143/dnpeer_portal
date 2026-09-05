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
  Edit3
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
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<PeeringSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending'>('all');
  const [sessionToDelete, setSessionToDelete] = useState<PeeringSession | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

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
              <span>Session Management &middot; <span className="text-slate-400 font-sans">我的互联会话</span></span>
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSessions.map((sess) => {
              const hostPort = sess.assigned?.hostPort || sess.peering?.listenPort || 0;
              const badge = getStatusBadge(sess);

              return (
                <div
                  key={sess.id}
                  className="glass-panel p-5 rounded-2xl border border-white/10 hover:border-cyan-500/30 transition-all space-y-4 bg-black/40 flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    {/* Top Row: Node & Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-bold text-white font-sans flex items-center gap-2">
                          <CountryFlag code={sess.nodeId} className="w-5 h-3.5 object-cover rounded-[2px]" />
                          <span>{sess.nodeId}</span>
                        </div>
                        <div className="text-[11px] font-mono text-cyan-400/80 mt-0.5 flex items-center gap-2">
                          <span>{sess.id}</span>
                          {sess.asn ? (
                            <span className="text-slate-400 font-sans text-[10px]">· AS{sess.asn}</span>
                          ) : (
                            <span className="text-amber-400/80 font-sans text-[10px]">· unknown ASN</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium ${badge.badgeClass}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dotClass}`} />
                          <span>{badge.label}</span>
                        </span>

                        {onEditSession && (
                          <button
                            onClick={() => onEditSession(sess)}
                            className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-colors cursor-pointer"
                            title="Edit or Re-submit Session"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => setSessionToDelete(sess)}
                          className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
                          title="Revoke Peering Session"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Diagnostic Info if BGP error / socket message */}
                    {sess.runtime?.bgpInfo && sess.runtime.bgpInfo !== sess.runtime.bgpState && (
                      <div className="text-[10px] text-amber-400/80 font-mono bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 truncate" title={sess.runtime.bgpInfo}>
                        Info: {sess.runtime.bgpInfo}
                      </div>
                    )}

                    {/* Parameters Grid */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono p-3 rounded-xl bg-black/50 border border-white/5">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Host Port</span>
                        <span className="text-cyan-300 font-semibold">{hostPort}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">MTU</span>
                        <span className="text-slate-300">{sess.peering?.mtu || 1420}</span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-slate-500 block text-[10px]">Link-Local IPv6 (LLA)</span>
                        <span className="text-slate-200">{sess.peering?.linkLocal || 'N/A'}</span>
                      </div>
                      {sess.peering?.ipv4 && (
                        <div>
                          <span className="text-slate-500 block text-[10px]">IPv4</span>
                          <span className="text-emerald-400">{sess.peering.ipv4}</span>
                        </div>
                      )}
                      {sess.peering?.ipv6Ula && (
                        <div>
                          <span className="text-slate-500 block text-[10px]">IPv6 ULA</span>
                          <span className="text-purple-400 truncate block">{sess.peering.ipv6Ula}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bottom Meta */}
                  <div className="text-[10px] text-slate-500 font-mono flex items-center justify-between border-t border-white/5 pt-2">
                    <span>Created: {new Date(sess.createdAt).toLocaleDateString()}</span>
                    <span className="flex items-center gap-2">
                      {sess.runtime?.latestHandshake && sess.runtime.latestHandshake > 0 ? (
                        <span className="text-emerald-400 font-medium">WG Up</span>
                      ) : (
                        <span className="text-slate-500">WG Idle</span>
                      )}
                      <span>&middot;</span>
                      <span>MP-BGP ENH</span>
                    </span>
                  </div>
                </div>
              );
            })}
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
