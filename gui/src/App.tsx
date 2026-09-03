import React, { useState, useEffect, useCallback } from 'react';
import { ApiClient, readTokenFromOPFS, type NetworkMeta, type PeeringSession } from './api/client';
import { ToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Navbar } from './components/Navbar';
import { HeroTelemetry } from './components/HeroTelemetry';
import { NodeGrid } from './components/NodeGrid';
import { ConfigGenerator } from './components/ConfigGenerator';
import { MyPeeringsDashboard } from './components/MyPeeringsDashboard';
import { LookingGlass } from './components/LookingGlass';
import { Footer } from './components/Footer';
import { AuthModal } from './components/AuthModal';
import { PasswordModal } from './components/PasswordModal';

const DEFAULT_META: NetworkMeta = {
  network: {
    asn: 'AS4242423143',
    asnNumber: 4242423143,
    networkName: 'AkiLab Networks',
    shortName: 'akilab',
    tagline: 'Automated BGP Peering & Routing Portal',
    description: 'AkiLab Networks is an experimental routing research network operated by DN42 participants. Peering requests are welcome!',
    maintainer: 'AKILAB-MNT',
    ipv4Pool: '172.20.150.0/24',
    ipv6Pool: 'fd00:4242:3143::/48',
    routingPolicy: 'Open',
    bgpMode: 'mpbgp_enh',
    portFormulaDisplay: '20000 + (ASN % 10000)',
    lookingGlassUrl: '',
    dn42WhoisUrl: 'https://explorer.burble.com/#/AS4242423143'
  },
  nodes: [
    {
      id: 'JP-TYO-1',
      code: 'JP-TYO-1',
      name: 'Tokyo Hub 01 (Japan)',
      flag: '🇯🇵',
      city: 'Tokyo',
      country: 'Japan',
      region: 'apac',
      status: 'offline',
      isp: 'AkiLab Core Backbone',
      endpointDomain: 'jp1.akilab.dn42',
      wgPublicKey: 'akilab_tokyo_wg_pubkey_replace_in_config_111111=',
      tunnelIpv4: '172.20.150.1',
      tunnelIpv6ULA: 'fd00:4242:3143::1',
      tunnelIpv6LLA: 'fe80::3143',
      mtu: 1420,
      features: ['mpbgp_enh', 'wireguard']
    },
    {
      id: 'US-SJC-1',
      code: 'US-SJC-1',
      name: 'Silicon Valley 01 (US West)',
      flag: '🇺🇸',
      city: 'San Jose',
      country: 'United States',
      region: 'na',
      status: 'offline',
      isp: 'AkiLab Core Backbone',
      endpointDomain: 'us1.akilab.dn42',
      wgPublicKey: 'akilab_sjc_wg_pubkey_replace_in_config_222222=',
      tunnelIpv4: '172.20.150.2',
      tunnelIpv6ULA: 'fd00:4242:3143::2',
      tunnelIpv6LLA: 'fe80::3143',
      mtu: 1420,
      features: ['mpbgp_enh', 'wireguard']
    }
  ],
  contacts: [
    {
      platform: 'Telegram',
      handle: '@akilab_bot',
      link: 'https://t.me/akilab_bot',
      type: 'telegram',
      preferred: true
    },
    {
      platform: 'DN42 WHOIS',
      handle: 'AKIRA-MNT',
      link: 'https://explorer.burble.com/#/AKIRA-MNT',
      type: 'whois'
    },
    {
      platform: 'DN42 Registry',
      handle: 'AS4242423143',
      link: 'https://explorer.burble.com/#/AS4242423143',
      type: 'registry'
    }
  ],
  guiPath: '/gui'
};

const AppContent: React.FC = () => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'home' | 'peer' | 'sessions' | 'lg'>('home');
  const [meta, setMeta] = useState<NetworkMeta>(DEFAULT_META);
  const [user, setUser] = useState<{ asn: number; asName: string; role: string } | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string>('JP-TYO-1');
  const [editingSession, setEditingSession] = useState<PeeringSession | null>(null);

  const loadData = useCallback(async () => {
    try {
      const metaRes = await ApiClient.getNetworkMeta();
      if (metaRes.success && metaRes.data) {
        setMeta(metaRes.data);
        if (metaRes.data.nodes?.length > 0) {
          setSelectedNodeId((prev) => prev || metaRes.data!.nodes[0].id);
        }
      }

      // If localStorage has no token, check OPFS persist token
      if (!ApiClient.getToken()) {
        const opfsToken = await readTokenFromOPFS();
        if (opfsToken) {
          localStorage.setItem('dn42_auth_token', opfsToken);
        }
      }

      if (ApiClient.getToken()) {
        const meRes = await ApiClient.getMe();
        if (meRes.success && meRes.data) {
          setUser(meRes.data);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch {
      // Fallback values already present
    }
  }, []);

  useEffect(() => {
    loadData();

    // Bi-directional token sync across browser tabs / windows
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'dn42_auth_token') {
        loadData();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [loadData]);

  const handleSelectNodeFromGrid = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setActiveTab('peer');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleLogout = () => {
    ApiClient.clearToken();
    setUser(null);
    showToast('👋 Signed out successfully', 'info');
  };

  const handleAuthSuccess = (_token: string, userData: any) => {
    setUser(userData);
    loadData();
  };

  return (
    <div className="w-full min-h-screen flex flex-col justify-between bg-[#06080d] text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      
      {/* Top Navbar */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        network={meta.network}
        user={user}
        onOpenAuthModal={() => setAuthModalOpen(true)}
        onOpenPasswordModal={() => setPasswordModalOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main View Area */}
      <main className="w-full flex-grow">
        {activeTab === 'home' && (
          <div className="space-y-6 step-reveal">
            {/* 1. Hero & Network Telemetry Overview */}
            <HeroTelemetry
              network={meta.network}
              onSelectTab={setActiveTab}
              onExploreNodes={() => {
                const el = document.querySelector('#nodes');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }}
            />

            {/* 2. Global PoP Infrastructure Nodes Table */}
            <NodeGrid
              nodes={meta.nodes}
              onSelectNode={handleSelectNodeFromGrid}
            />

            {/* 3. Real-time Looking Glass */}
            <LookingGlass
              nodes={meta.nodes}
              networkMeta={meta.network}
            />
          </div>
        )}

        {activeTab === 'peer' && (
          <div className="step-reveal">
            <ConfigGenerator
              nodes={meta.nodes}
              network={meta.network}
              user={user}
              targetNodeId={selectedNodeId}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              editingSession={editingSession}
              onClearEditingSession={() => setEditingSession(null)}
            />
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="step-reveal">
            <MyPeeringsDashboard
              user={user}
              onOpenAuthModal={() => setAuthModalOpen(true)}
              onRequestPeering={() => {
                setEditingSession(null);
                setActiveTab('peer');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onEditSession={(sess) => {
                setEditingSession(sess);
                setSelectedNodeId(sess.nodeId);
                setActiveTab('peer');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </div>
        )}

        {activeTab === 'lg' && (
          <div className="step-reveal">
            <LookingGlass
              nodes={meta.nodes}
              networkMeta={meta.network}
            />
          </div>
        )}
      </main>

      {/* Main Footer */}
      <Footer
        network={meta.network}
        contacts={meta.contacts}
        onScrollToLookingGlass={() => setActiveTab('lg')}
      />

      {/* Modals */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onSuccess={handleAuthSuccess}
      />

      <PasswordModal
        isOpen={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
      />

    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </ErrorBoundary>
  );
}
