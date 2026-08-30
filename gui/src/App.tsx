import React, { useState, useEffect } from 'react';
import {
  Globe, Server, Terminal, Shield, CheckCircle, AlertTriangle,
  RefreshCw, LogIn, LogOut, Trash2, Network, Activity, Zap, XCircle
} from 'lucide-react';
import { ApiClient, NetworkMeta, PeeringSession } from './api/client.ts';
import {
  validateAsn, validatePublicKey, validateIpv4, validateIpv6Ula,
  validateLinkLocal, validatePort, validateMtu, calcDefaultPort, formatDefaultLinkLocal,
  normalizeAsn
} from '@shared/generated/rules.js';

export default function App() {
  const [activeTab, setActiveTab] = useState<'wizard' | 'sessions' | 'nodes' | 'lg'>('wizard');
  const [meta, setMeta] = useState<NetworkMeta | null>(null);
  const [wizardNode, setWizardNode] = useState<string>('');
  const [user, setUser] = useState<{ asn: number; asName: string; role: string } | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Load Network Meta and Auth State
  const loadInitialData = async () => {
    const metaRes = await ApiClient.getNetworkMeta();
    if (metaRes.success && metaRes.data) {
      setMeta(metaRes.data);
      if (!wizardNode && metaRes.data.nodes?.length > 0) {
        setWizardNode(metaRes.data.nodes[0].id);
      }
    }
    const meRes = await ApiClient.getMe();
    if (meRes.success && meRes.data) {
      setUser(meRes.data);
    } else {
      setUser(null);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (meta?.nodes && meta.nodes.length > 0 && !wizardNode) {
      setWizardNode(meta.nodes[0].id);
    }
  }, [meta, wizardNode]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0b0f19', color: '#e2e8f0' }}>
      {/* Top Navbar */}
      <header style={{ borderBottom: '1px solid #1e293b', backgroundColor: 'rgba(19, 27, 46, 0.8)', backdropFilter: 'blur(8px)', position: 'sticky', top: 0, zIndex: 40 }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: 'rgba(0, 255, 170, 0.1)', border: '1px solid rgba(0, 255, 170, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00ffaa' }}>
              <Network size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {meta?.network.networkName || 'AkiLab DN42'}
                <span className="terminal-badge">2.0</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                ASN {meta?.network.asn || 'AS4242423143'} • MP-BGP ENH
              </div>
            </div>
          </div>

          {/* Nav Tabs */}
          <nav style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('wizard')}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'wizard' ? '#1e293b' : 'transparent', color: activeTab === 'wizard' ? '#00ffaa' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
            >
              <Zap size={16} /> 互联申请
            </button>
            <button
              onClick={() => setActiveTab('sessions')}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'sessions' ? '#1e293b' : 'transparent', color: activeTab === 'sessions' ? '#00ffaa' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
            >
              <Activity size={16} /> 我的会话
            </button>
            <button
              onClick={() => setActiveTab('nodes')}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'nodes' ? '#1e293b' : 'transparent', color: activeTab === 'nodes' ? '#00ffaa' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
            >
              <Server size={16} /> PoP 节点
            </button>
            <button
              onClick={() => setActiveTab('lg')}
              style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', backgroundColor: activeTab === 'lg' ? '#1e293b' : 'transparent', color: activeTab === 'lg' ? '#00ffaa' : '#94a3b8', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 500 }}
            >
              <Globe size={16} /> Looking Glass
            </button>
          </nav>

          {/* Auth & CLI Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <a
              href="/"
              style={{ textDecoration: 'none', color: '#38bdf8', padding: '6px 12px', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.3)', backgroundColor: 'rgba(56, 189, 248, 0.05)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Terminal size={14} /> CLI 终端
            </a>

            {user ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="terminal-badge">AS{user.asn} ({user.asName || 'Member'})</span>
                <button
                  onClick={() => { ApiClient.clearToken(); setUser(null); }}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', padding: '6px', display: 'flex', alignItems: 'center' }}
                  title="退出登录"
                >
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAuthModalOpen(true)}
                style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(0, 255, 170, 0.3)', backgroundColor: 'rgba(0, 255, 170, 0.1)', color: '#00ffaa', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              >
                <LogIn size={14} /> 登录 / 验签
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '24px 20px' }}>
        {activeTab === 'wizard' && (
          <PeeringWizard
            meta={meta}
            selectedNode={wizardNode}
            onSelectNode={setWizardNode}
            onSessionCreated={() => setActiveTab('sessions')}
          />
        )}
        {activeTab === 'sessions' && <SessionsDashboard user={user} onOpenLogin={() => setAuthModalOpen(true)} />}
        {activeTab === 'nodes' && (
          <NodesView
            meta={meta}
            onSelectNode={(nodeId) => {
              if (nodeId) setWizardNode(nodeId);
              setActiveTab('wizard');
            }}
          />
        )}
        {activeTab === 'lg' && <LookingGlassView meta={meta} />}
      </main>

      {/* Auth Modal */}
      {authModalOpen && <AuthModal onClose={() => setAuthModalOpen(false)} onAuthSuccess={(u) => { setUser(u); setAuthModalOpen(false); }} />}

      {/* Footer */}
      <footer style={{ borderTop: '1px solid #1e293b', padding: '20px', textAlign: 'center', fontSize: '0.8rem', color: '#64748b' }}>
        AkiLab DN42 Experimental Autonomous System • Built with Single Source of Truth Engine
      </footer>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component: Peering Wizard
// -----------------------------------------------------------------------------
function PeeringWizard({
  meta,
  selectedNode,
  onSelectNode,
  onSessionCreated
}: {
  meta: NetworkMeta | null;
  selectedNode: string;
  onSelectNode: (nodeId: string) => void;
  onSessionCreated: () => void;
}) {
  const [asn, setAsn] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [linkLocal, setLinkLocal] = useState('');
  const [ipv4, setIpv4] = useState('');
  const [ipv6Ula, setIpv6Ula] = useState('');
  const [endpoint, setEndpoint] = useState('');

  // Dual Port Controls (R1)
  const [listenPortChoice, setListenPortChoice] = useState<'auto' | 'custom'>('auto');
  const [customListenPort, setCustomListenPort] = useState('');
  const [clientPortChoice, setClientPortChoice] = useState<'auto' | 'custom'>('auto');
  const [customClientPort, setCustomClientPort] = useState('');

  const [mtu, setMtu] = useState('1420');
  const [contact, setContact] = useState('');

  // Error States (R2 & M4)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [unmappedErrors, setUnmappedErrors] = useState<string[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<any>(null);

  // Auto-fill Link-Local on ASN change
  useEffect(() => {
    if (asn) {
      const clean = normalizeAsn(asn);
      if (clean && !linkLocal) {
        setLinkLocal(formatDefaultLinkLocal(clean));
      }
    }
  }, [asn, linkLocal]);

  // Ensure selectedNode is initialized when meta arrives
  useEffect(() => {
    if (meta?.nodes && meta.nodes.length > 0) {
      if (!selectedNode || !meta.nodes.some(n => n.id === selectedNode)) {
        onSelectNode(meta.nodes[0].id);
      }
    }
  }, [meta, selectedNode, onSelectNode]);

  // Realtime 0ms validation (M4 + R2)
  const validateForm = () => {
    const errs: Record<string, string> = {};

    if (!selectedNode) {
      errs.nodeId = 'Target PoP Node is required';
    }

    const asnRes = validateAsn(asn);
    if (!asnRes.valid) errs.asn = asnRes.error || 'Invalid ASN';

    const pubRes = validatePublicKey(publicKey);
    if (!pubRes.valid) errs.publicKey = pubRes.error || 'Invalid WG Public Key';

    const llaRes = validateLinkLocal(linkLocal);
    if (!llaRes.valid) errs.linkLocal = llaRes.error || 'Invalid Link-Local';

    if (ipv4) {
      const v4Res = validateIpv4(ipv4, true);
      if (!v4Res.valid) errs.ipv4 = v4Res.error || 'Invalid IPv4';
    }

    if (ipv6Ula) {
      const v6Res = validateIpv6Ula(ipv6Ula, true);
      if (!v6Res.valid) errs.ipv6Ula = v6Res.error || 'Invalid IPv6 ULA';
    }

    if (listenPortChoice === 'custom') {
      const pRes = validatePort(customListenPort, false);
      if (!pRes.valid) errs.listenPort = pRes.error || 'Invalid Server ListenPort';
    }

    if (clientPortChoice === 'custom' && customClientPort.trim()) {
      const cpRes = validatePort(customClientPort, false);
      if (!cpRes.valid) errs.clientPort = cpRes.error || 'Invalid Client ListenPort';
    }

    // MTU Validation (M4)
    const mtuRes = validateMtu(mtu);
    if (!mtuRes.valid) errs.mtu = mtuRes.error || 'Invalid MTU';

    setFieldErrors(errs);
    setUnmappedErrors([]);
    setGeneralError(null);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setGeneralError(null);
    setUnmappedErrors([]);

    const payload = {
      asn: normalizeAsn(asn),
      nodeId: selectedNode,
      publicKey: publicKey.trim(),
      linkLocal: linkLocal.trim(),
      ipv4: ipv4.trim() || undefined,
      ipv6Ula: ipv6Ula.trim() || undefined,
      endpoint: endpoint.trim() || undefined,
      listenPort: listenPortChoice === 'auto' ? 'auto' : parseInt(customListenPort, 10),
      clientPort: clientPortChoice === 'auto' || !customClientPort.trim() ? 'auto' : parseInt(customClientPort, 10),
      mtu: parseInt(mtu, 10) || 1420,
      contact: contact.trim() || undefined,
      bgpMode: 'mpbgp_enh'
    };

    const res = await ApiClient.submitPeering(payload);
    setSubmitting(false);

    if (res.success && res.data) {
      setSubmitResult(res.data);
      setFieldErrors({});
      setUnmappedErrors([]);
      setGeneralError(null);
    } else {
      const backendFieldErrors = res.error?.fieldErrors || {};
      const knownErrors: Record<string, string> = {};
      const unmapped: string[] = [];

      const RENDERED_FIELDS = new Set([
        'asn', 'nodeId', 'publicKey', 'linkLocal', 'ipv4', 'ipv6Ula',
        'endpoint', 'listenPort', 'clientPort', 'mtu', 'contact', 'bgpMode'
      ]);

      for (const [key, msg] of Object.entries(backendFieldErrors)) {
        if (RENDERED_FIELDS.has(key)) {
          knownErrors[key] = msg;
        } else {
          unmapped.push(`${key}: ${msg}`);
        }
      }

      setFieldErrors(knownErrors);
      setUnmappedErrors(unmapped);
      setGeneralError(res.error?.message || (unmapped.length > 0 ? '提交未能通过服务端校验' : '提交互联申请失败'));
    }
  };

  if (submitResult) {
    return (
      <div className="glass-card" style={{ padding: '32px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#00ffaa', marginBottom: '16px' }}>
          <CheckCircle size={28} />
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>申请已提交 / Peering Submitted</h2>
        </div>

        <div style={{ backgroundColor: 'rgba(0, 255, 170, 0.05)', border: '1px solid rgba(0, 255, 170, 0.2)', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
          <div style={{ fontWeight: 600, fontSize: '1.1rem', marginBottom: '8px', color: '#00ffaa' }}>
            Session ID: <code>{submitResult.sessionId}</code>
          </div>
          <div style={{ color: '#cbd5e1', fontSize: '0.95rem' }}>
            {submitResult.acknowledgement}
          </div>
          {submitResult.conflictMessage && (
            <div style={{ marginTop: '10px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}>
              <AlertTriangle size={16} /> {submitResult.conflictMessage}
            </div>
          )}
        </div>

        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '12px' }}>
          WireGuard 客户端配置示例 / Client WireGuard Config (Reference Only)
        </h3>
        <pre style={{ backgroundColor: '#070a12', padding: '16px', borderRadius: '8px', border: '1px solid #1e293b', overflowX: 'auto', fontSize: '0.85rem', color: '#38bdf8' }}>
          {submitResult.clientWireguard || submitResult.configs?.clientWireguard}
        </pre>

        <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
          <button
            onClick={() => setSubmitResult(null)}
            style={{ padding: '10px 20px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#1e293b', color: '#fff', fontWeight: 500 }}
          >
            再次申请 / New Peer
          </button>
          <button
            onClick={onSessionCreated}
            style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700 }}
          >
            查看会话列表 / View Sessions
          </button>
        </div>
      </div>
    );
  }

  const expectedPort = calcDefaultPort(asn || '4242423143');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px' }}>
      {/* Form Area */}
      <form onSubmit={handleSubmit} className="glass-card" style={{ padding: '28px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Zap size={22} color="#00ffaa" /> DN42 自动互联申请向导
        </h2>

        {/* Global Error Banner / Unmapped Errors (R2) */}
        {(generalError || unmappedErrors.length > 0) && (
          <div style={{ backgroundColor: 'rgba(244, 63, 94, 0.1)', border: '1px solid #f43f5e', borderRadius: '8px', padding: '14px', marginBottom: '20px', color: '#fca5a5' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.95rem' }}>
              <XCircle size={18} color="#f43f5e" /> {generalError || '表单提交存在错误，请核对后重试'}
            </div>
            {unmappedErrors.length > 0 && (
              <ul style={{ margin: '8px 0 0 20px', padding: 0, fontSize: '0.85rem' }}>
                {unmappedErrors.map((err, idx) => (
                  <li key={idx}><code>{err}</code></li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 1. Node Selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px', color: '#cbd5e1' }}>
            选择接入节点 / Target PoP Node <span style={{ color: '#f43f5e' }}>*</span>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
            {meta?.nodes.map(n => (
              <div
                key={n.id}
                onClick={() => onSelectNode(n.id)}
                style={{
                  padding: '12px',
                  borderRadius: '8px',
                  border: selectedNode === n.id ? '2px solid #00ffaa' : (fieldErrors.nodeId ? '1px solid #f43f5e' : '1px solid #1e293b'),
                  backgroundColor: selectedNode === n.id ? 'rgba(0, 255, 170, 0.05)' : '#131b2e',
                  cursor: 'pointer'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{n.flag} {n.name}</span>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{n.city}, {n.country} • {n.isp}</div>
              </div>
            ))}
          </div>
          {fieldErrors.nodeId && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.nodeId}</div>}
        </div>

        {/* 2. ASN */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', color: '#cbd5e1' }}>
            您的 ASN / Your ASN <span style={{ color: '#f43f5e' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="e.g. 4242423143"
            value={asn}
            onChange={e => setAsn(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.asn ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.95rem' }}
          />
          {fieldErrors.asn && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.asn}</div>}
        </div>

        {/* 3. WireGuard Public Key */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', color: '#cbd5e1' }}>
            WireGuard 公钥 / Public Key (44 位 Base64) <span style={{ color: '#f43f5e' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E="
            value={publicKey}
            onChange={e => setPublicKey(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.publicKey ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.95rem', fontFamily: 'monospace' }}
          />
          {fieldErrors.publicKey && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.publicKey}</div>}
        </div>

        {/* 4. Link-Local Address */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px', color: '#cbd5e1' }}>
            IPv6 Link-Local 互联地址 / Link-Local LLA <span style={{ color: '#f43f5e' }}>*</span>
          </label>
          <input
            type="text"
            placeholder="fe80::4242:3143"
            value={linkLocal}
            onChange={e => setLinkLocal(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.linkLocal ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.95rem', fontFamily: 'monospace' }}
          />
          {fieldErrors.linkLocal && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.linkLocal}</div>}
        </div>

        {/* 5. Dual Stack IPs (IPv4 / IPv6 ULA) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
              DN42 IPv4 (选填 / Optional)
            </label>
            <input
              type="text"
              placeholder="172.20.150.1"
              value={ipv4}
              onChange={e => setIpv4(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.ipv4 ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
            />
            {fieldErrors.ipv4 && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.ipv4}</div>}
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
              DN42 IPv6 ULA (选填 / Optional)
            </label>
            <input
              type="text"
              placeholder="fd00:4242:3143::1"
              value={ipv6Ula}
              onChange={e => setIpv6Ula(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.ipv6Ula ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
            />
            {fieldErrors.ipv6Ula && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.ipv6Ula}</div>}
          </div>
        </div>

        {/* 6. Endpoint */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
            对端 Endpoint (选填，支持 DDNS)
          </label>
          <input
            type="text"
            placeholder="your-domain.dn42"
            value={endpoint}
            onChange={e => setEndpoint(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.endpoint ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
          />
          {fieldErrors.endpoint && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.endpoint}</div>}
        </div>

        {/* 7. Dual Port Controls (R1) */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
          {/* Server ListenPort (AkiLab Side) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#cbd5e1' }}>
                服务端端口 (AkiLab 侧)
              </label>
              <button
                type="button"
                onClick={() => { setListenPortChoice('custom'); setCustomListenPort(String(expectedPort)); }}
                style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.75rem', cursor: 'pointer', padding: 0 }}
                title="填入根据 ASN 算得的建议端口"
              >
                填入建议值 ({expectedPort})
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setListenPortChoice('auto')}
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: listenPortChoice === 'auto' ? '1px solid #00ffaa' : '1px solid #1e293b', backgroundColor: listenPortChoice === 'auto' ? 'rgba(0, 255, 170, 0.1)' : '#070a12', color: listenPortChoice === 'auto' ? '#00ffaa' : '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}
              >
                自动 (auto 裁决)
              </button>
              <button
                type="button"
                onClick={() => setListenPortChoice('custom')}
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: listenPortChoice === 'custom' ? '1px solid #00ffaa' : '1px solid #1e293b', backgroundColor: listenPortChoice === 'custom' ? 'rgba(0, 255, 170, 0.1)' : '#070a12', color: listenPortChoice === 'custom' ? '#00ffaa' : '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}
              >
                指定端口
              </button>
            </div>
            {listenPortChoice === 'custom' && (
              <input
                type="number"
                placeholder="1024-65535"
                value={customListenPort}
                onChange={e => setCustomListenPort(e.target.value)}
                style={{ width: '100%', marginTop: '8px', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.listenPort ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
              />
            )}
            {fieldErrors.listenPort && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.listenPort}</div>}
          </div>

          {/* Client ListenPort (User Side, wg0.conf) */}
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
              客户端端口 (您本地 wg0.conf)
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setClientPortChoice('auto')}
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: clientPortChoice === 'auto' ? '1px solid #00ffaa' : '1px solid #1e293b', backgroundColor: clientPortChoice === 'auto' ? 'rgba(0, 255, 170, 0.1)' : '#070a12', color: clientPortChoice === 'auto' ? '#00ffaa' : '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}
              >
                自动 (留空随机)
              </button>
              <button
                type="button"
                onClick={() => setClientPortChoice('custom')}
                style={{ flex: 1, padding: '8px', borderRadius: '6px', border: clientPortChoice === 'custom' ? '1px solid #00ffaa' : '1px solid #1e293b', backgroundColor: clientPortChoice === 'custom' ? 'rgba(0, 255, 170, 0.1)' : '#070a12', color: clientPortChoice === 'custom' ? '#00ffaa' : '#94a3b8', fontSize: '0.8rem', fontWeight: 600 }}
              >
                固定端口
              </button>
            </div>
            {clientPortChoice === 'custom' && (
              <input
                type="number"
                placeholder="1024-65535 (选填)"
                value={customClientPort}
                onChange={e => setCustomClientPort(e.target.value)}
                style={{ width: '100%', marginTop: '8px', padding: '8px 12px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.clientPort ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
              />
            )}
            {fieldErrors.clientPort && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.clientPort}</div>}
          </div>
        </div>

        {/* 8. MTU and Contact */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
              MTU (默认 1420，范围 1280-1500)
            </label>
            <input
              type="number"
              value={mtu}
              onChange={e => setMtu(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.mtu ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
            />
            {fieldErrors.mtu && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.mtu}</div>}
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
              联系方式 (Telegram / 邮箱)
            </label>
            <input
              type="text"
              placeholder="@your_telegram"
              value={contact}
              onChange={e => setContact(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: fieldErrors.contact ? '1px solid #f43f5e' : '1px solid #1e293b', color: '#fff', fontSize: '0.9rem' }}
            />
            {fieldErrors.contact && <div style={{ color: '#f43f5e', fontSize: '0.8rem', marginTop: '4px' }}>{fieldErrors.contact}</div>}
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting}
          style={{ width: '100%', padding: '14px', borderRadius: '8px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontSize: '1rem', fontWeight: 700, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? <RefreshCw size={20} className="animate-spin" /> : <Zap size={20} />}
          {submitting ? '提交裁决中...' : '提交互联申请 / Submit Peering'}
        </button>
      </form>

      {/* Sidebar: Real-time Rule Explanation & Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8' }}>
            <Shield size={16} /> 端口与裁决规则
          </h3>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>
            <p style={{ margin: '0 0 8px 0' }}>• 默认端口建议值：<code>20000 + (ASN % 10000)</code> = <b style={{ color: '#00ffaa' }}>{expectedPort}</b></p>
            <p style={{ margin: '0 0 8px 0' }}>• <b>服务端端口</b>：AkiLab 侧监听端口。默认 <code>auto</code> 由系统自动分配并在冲突时顺延；亦可手动指定。</p>
            <p style={{ margin: '0' }}>• <b>客户端端口</b>：若填写则写入本地 <code>wg0.conf</code> 的 <code>ListenPort</code>；留空则客户端系统自动分配随机 UDP 端口。</p>
          </div>
        </div>

        <div className="glass-card" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px', color: '#00ffaa' }}>
            <Terminal size={16} /> 0ms 本地前置预览
          </h3>
          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', backgroundColor: '#070a12', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b' }}>
            <div><b>Target PoP</b>: {selectedNode || 'None selected'}</div>
            <div><b>Target ASN</b>: AS{asn || '424242xxxx'}</div>
            <div><b>LLA</b>: {linkLocal || 'fe80::...'}</div>
            <div><b>Server Port</b>: {listenPortChoice === 'custom' ? (customListenPort || 'Custom') : `auto (建议 ${expectedPort})`}</div>
            <div><b>Client Port</b>: {clientPortChoice === 'custom' ? (customClientPort || 'auto') : 'auto (随机)'}</div>
            <div><b>MTU</b>: {mtu || 1420}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component: Sessions Dashboard
// -----------------------------------------------------------------------------
function SessionsDashboard({ user, onOpenLogin }: { user: any; onOpenLogin: () => void }) {
  const [sessions, setSessions] = useState<PeeringSession[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSessions = async () => {
    setLoading(true);
    const res = await ApiClient.getSessions();
    setLoading(false);
    if (res.success && res.data) {
      setSessions(res.data);
    }
  };

  useEffect(() => {
    if (user) {
      fetchSessions();
    }
  }, [user]);

  if (!user) {
    return (
      <div className="glass-card" style={{ padding: '48px', textAlign: 'center', maxWidth: '600px', margin: '40px auto' }}>
        <Shield size={48} color="#00ffaa" style={{ margin: '0 auto 16px auto' }} />
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '12px' }}>需要验证身份 / Authentication Required</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '24px' }}>
          请使用 SSH 签名或沙盒测试账户登录，以管理归属于您 ASN 的互联会话。
        </p>
        <button
          onClick={onOpenLogin}
          style={{ padding: '12px 24px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700, fontSize: '0.95rem' }}
        >
          立即登录 / Sign In
        </button>
      </div>
    );
  }

  const handleDelete = async (sessionId: string) => {
    if (!confirm(`确定要删除会话 ${sessionId} 吗？端口将被释放。`)) return;
    const res = await ApiClient.deleteSession(sessionId);
    if (res.success) {
      fetchSessions();
    } else {
      alert(res.error?.message || 'Delete failed');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={22} color="#00ffaa" /> 会话管理 / My Peering Sessions
        </h2>
        <button
          onClick={fetchSessions}
          style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid #1e293b', backgroundColor: '#131b2e', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: 500 }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新会话
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="glass-card" style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
          暂无已注册互联会话。欢迎前往「互联申请」向导创建第一个 Peer！
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {sessions.map(s => (
            <div key={s.id} className="glass-card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>AS{s.asn}</span>
                    <span className="terminal-badge">{s.nodeId}</span>
                    <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '4px', backgroundColor: s.status === 'active' ? 'rgba(0, 255, 170, 0.15)' : 'rgba(251, 191, 36, 0.15)', color: s.status === 'active' ? '#00ffaa' : '#fbbf24' }}>
                      {s.runtime?.stageText || s.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                    Session ID: <code>{s.id}</code> • 端口: <b>{s.assigned.hostPort}</b>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(s.id)}
                  style={{ background: 'transparent', border: 'none', color: '#f43f5e', padding: '6px' }}
                  title="删除互联会话"
                >
                  <Trash2 size={18} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.85rem', backgroundColor: '#070a12', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                <div><b>对端 LLA</b>: <code>{s.peering.linkLocal}</code></div>
                <div><b>对端 IPv4</b>: <code>{s.peering.ipv4 || 'None'}</code></div>
                <div><b>服务端 Endpoint</b>: <code>{s.assigned.serverEndpoint}</code></div>
                <div><b>最新握手</b>: <span>{s.runtime?.latestHandshake ? `${new Date(s.runtime.latestHandshake * 1000).toLocaleString()}` : '等待对端握手'}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component: Nodes View
// -----------------------------------------------------------------------------
function NodesView({ meta, onSelectNode }: { meta: NetworkMeta | null; onSelectNode: (nodeId?: string) => void }) {
  return (
    <div>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Server size={22} color="#00ffaa" /> 全网 PoP 骨干节点 / Backbone PoPs
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {meta?.nodes.map(n => (
          <div key={n.id} className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '1.3rem' }}>{n.flag}</span>
                <span className="terminal-badge">{n.code}</span>
              </div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 6px 0' }}>{n.name}</h3>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>{n.city}, {n.country} • {n.isp}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.8rem', backgroundColor: '#070a12', padding: '12px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                <div><b>Endpoint</b>: <code>{n.endpointDomain}</code></div>
                <div><b>IPv4</b>: <code>{n.tunnelIpv4}</code></div>
                <div><b>IPv6 ULA</b>: <code>{n.tunnelIpv6ULA}</code></div>
                <div><b>IPv6 LLA</b>: <code>{n.tunnelIpv6LLA}</code></div>
              </div>
            </div>

            <button
              onClick={() => onSelectNode(n.id)}
              style={{ marginTop: '20px', width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid rgba(0, 255, 170, 0.3)', backgroundColor: 'rgba(0, 255, 170, 0.05)', color: '#00ffaa', fontWeight: 600, fontSize: '0.9rem' }}
            >
              接入此节点 / Peer on this PoP
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component: Looking Glass
// -----------------------------------------------------------------------------
function LookingGlassView({ meta }: { meta: NetworkMeta | null }) {
  const [selectedNode, setSelectedNode] = useState(meta?.nodes[0]?.id || 'JP-TYO-1');
  const [command, setCommand] = useState('summary');
  const [target, setTarget] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (meta?.nodes && meta.nodes.length > 0 && !selectedNode) {
      setSelectedNode(meta.nodes[0].id);
    }
  }, [meta, selectedNode]);

  const handleQuery = async () => {
    setLoading(true);
    const res = await ApiClient.queryLookingGlass(selectedNode, command, target);
    setLoading(false);
    if (res.success && res.data) {
      setOutput(res.data.output || 'No output returned');
    } else {
      setOutput(res.error?.message || 'Query failed');
    }
  };

  return (
    <div className="glass-card" style={{ padding: '28px' }}>
      <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Globe size={22} color="#00ffaa" /> Looking Glass 路由与 BGP 状态查询
      </h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '12px', marginBottom: '20px' }}>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff' }}
        >
          {meta?.nodes.map(n => <option key={n.id} value={n.id}>{n.flag} {n.name}</option>)}
        </select>

        <select
          value={command}
          onChange={e => setCommand(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff' }}
        >
          <option value="summary">BGP Summary (概要)</option>
          <option value="protocols">Show Protocols</option>
          <option value="route">Show Route</option>
        </select>

        <input
          type="text"
          placeholder="IP / Prefix (e.g. 172.20.0.0/14)"
          value={target}
          onChange={e => setTarget(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff' }}
        >
        </input>

        <button
          onClick={handleQuery}
          disabled={loading}
          style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700 }}
        >
          {loading ? '查询中...' : 'Execute'}
        </button>
      </div>

      <pre style={{ backgroundColor: '#070a12', padding: '16px', borderRadius: '8px', border: '1px solid #1e293b', minHeight: '240px', overflowX: 'auto', fontSize: '0.85rem', color: '#38bdf8' }}>
        {output || '选择节点与指令并点击 Execute 执行查询...'}
      </pre>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Component: Auth Modal
// -----------------------------------------------------------------------------
function AuthModal({ onClose, onAuthSuccess }: { onClose: () => void; onAuthSuccess: (user: any) => void }) {
  const [tab, setTab] = useState<'ssh' | 'password'>('ssh');
  const [asnInput, setAsnInput] = useState('');
  const [challengeData, setChallengeData] = useState<any>(null);
  const [signature, setSignature] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleGetChallenge = async () => {
    if (!asnInput) return;
    setLoading(true);
    const res = await ApiClient.getChallenge(asnInput);
    setLoading(false);
    if (res.success && res.data) {
      setChallengeData(res.data);
    } else {
      alert(res.error?.message || 'Failed to get challenge');
    }
  };

  const handleVerifySig = async () => {
    if (!signature || !challengeData) return;
    setLoading(true);
    const res = await ApiClient.verifySignature(asnInput, challengeData.challengeText, signature, rememberMe);
    setLoading(false);
    if (res.success && res.data) {
      ApiClient.setToken(res.data.token);
      onAuthSuccess(res.data);
    } else {
      alert(res.error?.message || 'SSH Signature Verification Failed');
    }
  };

  const handlePasswordLogin = async () => {
    if (!username || !password) return;
    setLoading(true);
    const res = await ApiClient.loginPassword(username, password, rememberMe);
    setLoading(false);
    if (res.success && res.data) {
      ApiClient.setToken(res.data.token);
      onAuthSuccess(res.data);
    } else {
      alert(res.error?.message || 'Login failed');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '20px' }}>
      <div className="glass-card" style={{ maxWidth: '520px', width: '100%', padding: '28px', position: 'relative' }}>
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
        >
          ✕
        </button>

        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Shield size={20} color="#00ffaa" /> 身份验证 / Authentication
        </h2>

        {/* Tab Switcher */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
          <button
            onClick={() => setTab('ssh')}
            style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', backgroundColor: tab === 'ssh' ? '#1e293b' : 'transparent', color: tab === 'ssh' ? '#00ffaa' : '#94a3b8', fontWeight: 600, fontSize: '0.9rem' }}
          >
            SSH 密码学验签 (权威)
          </button>
          <button
            onClick={() => setTab('password')}
            style={{ flex: 1, padding: '8px', borderRadius: '6px', border: 'none', backgroundColor: tab === 'password' ? '#1e293b' : 'transparent', color: tab === 'password' ? '#00ffaa' : '#94a3b8', fontWeight: 600, fontSize: '0.9rem' }}
          >
            密码登录 / 快捷凭证
          </button>
        </div>

        {tab === 'ssh' ? (
          <div>
            {!challengeData ? (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
                  您的 DN42 ASN / Account
                </label>
                <input
                  type="text"
                  placeholder="4242423143"
                  value={asnInput}
                  onChange={e => setAsnInput(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff', fontSize: '0.95rem', marginBottom: '16px' }}
                />
                <button
                  onClick={handleGetChallenge}
                  disabled={loading || !asnInput}
                  style={{ width: '100%', padding: '12px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700 }}
                >
                  {loading ? '获取 Challenge 中...' : '获取随机 Challenge / Get Challenge'}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px' }}>
                  请使用您在 DN42 Registry 注册的 SSH 私钥执行以下命令进行离线签名：
                </p>
                <div style={{ backgroundColor: '#070a12', padding: '10px', borderRadius: '6px', border: '1px solid #1e293b', fontSize: '0.8rem', color: '#38bdf8', marginBottom: '12px', wordBreak: 'break-all' }}>
                  <code>{challengeData.commandLinux || challengeData.commands?.ssh_linux}</code>
                </div>

                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
                  粘贴完整的 SSH 签名块 / Paste Signature
                </label>
                <textarea
                  rows={4}
                  placeholder="-----BEGIN SSH SIGNATURE-----&#10;...&#10;-----END SSH SIGNATURE-----"
                  value={signature}
                  onChange={e => setSignature(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff', fontSize: '0.85rem', fontFamily: 'monospace', marginBottom: '16px' }}
                />

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                  <input
                    type="checkbox"
                    id="rem"
                    checked={rememberMe}
                    onChange={e => setRememberMe(e.target.checked)}
                  />
                  <label htmlFor="rem" style={{ fontSize: '0.85rem', color: '#94a3b8' }}>30 天内保持登录 / Remember Me</label>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setChallengeData(null)}
                    style={{ padding: '10px 16px', borderRadius: '6px', border: '1px solid #334155', backgroundColor: '#1e293b', color: '#fff' }}
                  >
                    重置
                  </button>
                  <button
                    onClick={handleVerifySig}
                    disabled={loading || !signature}
                    style={{ flex: 1, padding: '10px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700 }}
                  >
                    {loading ? '校验签名中...' : '提交签名 / Verify & Sign In'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
                ASN 或用户名
              </label>
              <input
                type="text"
                placeholder="4242423143"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff', fontSize: '0.95rem' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px', color: '#cbd5e1' }}>
                密码
              </label>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '6px', backgroundColor: '#070a12', border: '1px solid #1e293b', color: '#fff', fontSize: '0.95rem' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <input
                type="checkbox"
                id="remPass"
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
              />
              <label htmlFor="remPass" style={{ fontSize: '0.85rem', color: '#94a3b8' }}>30 天内保持登录 / Remember Me</label>
            </div>

            <button
              onClick={handlePasswordLogin}
              disabled={loading || !username || !password}
              style={{ width: '100%', padding: '12px', borderRadius: '6px', border: 'none', backgroundColor: '#00ffaa', color: '#0b0f19', fontWeight: 700 }}
            >
              {loading ? '登录中...' : '登录 / Sign In'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
