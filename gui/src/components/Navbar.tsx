import React, { useState, useEffect, useRef } from 'react';
import type { NetworkMeta } from '../api/client';
import { CURRENT_BRAND_LOGO } from '../utils/brandLogo';
import {
  Layers,
  Terminal,
  Activity,
  ShieldCheck,
  LogIn,
  ChevronDown,
  KeyRound,
  LogOut,
  Menu,
  X,
  Mail
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'home' | 'peer' | 'sessions' | 'lg';
  onSelectTab: (tab: 'home' | 'peer' | 'sessions' | 'lg') => void;
  network: NetworkMeta['network'];
  user: { asn: number; asName: string; mnt?: string; role: string } | null;
  onOpenAuthModal: () => void;
  onOpenPasswordModal: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  network,
  user,
  onOpenAuthModal,
  onOpenPasswordModal,
  onLogout,
}) => {
  const [utcTime, setUtcTime] = useState<string>('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [userMenuOpen, setUserMenuOpen] = useState<boolean>(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Click outside to close user dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().slice(17, 25) + ' UTC');
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const handleContactClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const el = document.querySelector('#contact');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-[#070a11]/90 backdrop-blur-xl transition-all">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        
        {/* Left: Brand */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSelectTab('home')}
            className="flex items-center gap-3 group text-left cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center group-hover:border-cyan-400 transition-all duration-300 shadow-lg shadow-cyan-950/40 overflow-hidden shrink-0">
              <img
                src={CURRENT_BRAND_LOGO}
                alt={`${network.networkName} Logo`}
                className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base tracking-tight text-white font-sans leading-tight">
                {network.networkName}
              </span>
              <span className="text-[10px] uppercase font-mono text-cyan-400/80 tracking-widest">
                DN42 Autonomous System
              </span>
            </div>
          </button>
        </div>

        {/* Center: Desktop Navigation */}
        <nav className="hidden lg:flex items-center gap-1.5 font-sans">
          <button
            onClick={() => onSelectTab('home')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'home'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-300 hover:text-cyan-300 hover:bg-white/[0.05]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Overview</span>
          </button>

          <button
            onClick={() => onSelectTab('sessions')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'sessions'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                : 'text-slate-300 hover:text-cyan-300 hover:bg-white/[0.05]'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Sessions</span>
          </button>

          <a
            href="#contact"
            onClick={handleContactClick}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-cyan-300 hover:bg-white/[0.05] transition-all cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Contact</span>
          </a>
        </nav>

        {/* Right: Live UTC Clock & User Dashboard / Auth Entry */}
        <div className="flex items-center gap-2.5">
          <div className="hidden xl:flex flex-col text-right font-mono text-[11px] text-slate-400 bg-black/50 px-3 py-1 rounded-lg border border-white/5">
            <span className="text-slate-500 text-[9px] uppercase">Telemetry Sync</span>
            <span className="text-cyan-300 font-semibold">{utcTime}</span>
          </div>

          {/* Web Terminal (CLI) Switcher Link */}
          <a
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-cyan-500/40 text-xs text-slate-300 hover:text-cyan-300 font-mono transition-all"
            title="Switch to WebAssembly Linux CLI Terminal"
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>CLI</span>
          </a>

          {/* User Auth Section */}
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-semibold hover:border-cyan-400 transition-all cursor-pointer shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                <span>AS{user.asn}</span>
                <ChevronDown className="w-3 h-3 text-cyan-500" />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-52 rounded-2xl bg-[#0b0f19] border border-white/10 shadow-2xl p-2 z-50 text-xs font-sans space-y-1 animate-in fade-in">
                  <div className="px-3 py-2 border-b border-white/5">
                    <div className="font-semibold text-white truncate">{user.mnt || user.asName || `AS${user.asn}`}</div>
                    <div className="text-[10px] text-slate-500 font-mono">Role: {user.role}</div>
                  </div>

                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      onOpenPasswordModal();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/5 text-slate-200 hover:text-cyan-300 flex items-center gap-2 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                    <span>Change Password</span>
                  </button>

                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-500/10 text-rose-300 flex items-center gap-2 cursor-pointer border-t border-white/5"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={onOpenAuthModal}
              className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>

      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-white/10 bg-[#070a11] px-4 py-3 space-y-2 text-xs font-sans animate-in fade-in">
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              onSelectTab('home');
            }}
            className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 ${
              activeTab === 'home' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-300'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Overview</span>
          </button>
          <button
            onClick={() => {
              setMobileMenuOpen(false);
              onSelectTab('sessions');
            }}
            className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2 ${
              activeTab === 'sessions' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-300'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Sessions</span>
          </button>
          <a
            href="#contact"
            onClick={handleContactClick}
            className="block w-full text-left px-3 py-2 rounded-xl text-slate-300 hover:text-cyan-300 transition-colors"
          >
            <span>Contact</span>
          </a>
        </div>
      )}
    </header>
  );
};
