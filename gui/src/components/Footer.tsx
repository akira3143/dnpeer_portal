import React from 'react';
import type { NetworkMeta } from '../api/client';
import { useToast } from './Toast';
import { CURRENT_BRAND_LOGO } from '../utils/brandLogo';
import { ArrowUp, ExternalLink, Send, Mail, MessageSquare, Globe, Copy, Shield } from 'lucide-react';

interface FooterProps {
  network: NetworkMeta['network'];
  contacts: NetworkMeta['contacts'];
  onScrollToLookingGlass?: () => void;
}

export const Footer: React.FC<FooterProps> = ({ network, contacts, onScrollToLookingGlass }) => {
  const { copyToClipboard } = useToast();

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const getPlatformIcon = (type: string, platform: string = '') => {
    const t = (type || '').toLowerCase();
    const p = (platform || '').toLowerCase();
    if (t === 'telegram' || p.includes('telegram')) {
      return <Send className="w-4 h-4 text-cyan-400" />;
    }
    if (t === 'email' || p.includes('email') || p.includes('mail')) {
      return <Mail className="w-4 h-4 text-purple-400" />;
    }
    if (t === 'matrix' || p.includes('matrix')) {
      return <MessageSquare className="w-4 h-4 text-emerald-400" />;
    }
    if (t === 'whois' || t === 'registry' || p.includes('whois')) {
      return <Shield className="w-4 h-4 text-amber-400" />;
    }
    return <Globe className="w-4 h-4 text-slate-400" />;
  };

  const resolveContactLink = (item: { platform: string; handle: string; link?: string; type?: string }) => {
    const t = (item.type || '').toLowerCase();
    const p = (item.platform || '').toLowerCase();
    const cleanHandle = (item.handle || '').trim();

    if (item.link && item.link.trim() && item.link.trim() !== '#') {
      const l = item.link.trim();
      if (!l.includes('dn42.dev/whois') && !l.includes('.dn42/')) {
        return l;
      }
    }

    if (t === 'telegram' || p.includes('telegram')) {
      return `https://t.me/${cleanHandle.replace(/^@/, '')}`;
    }
    if (t === 'email' || p.includes('email') || p.includes('mail')) {
      return `mailto:${cleanHandle}`;
    }
    if (t === 'matrix' || p.includes('matrix')) {
      return `https://matrix.to/#/${cleanHandle}`;
    }
    if (t === 'whois' || t === 'registry' || p.includes('whois') || cleanHandle.includes('DN42') || cleanHandle.includes('MNT')) {
      return `https://explorer.burble.com/#/${encodeURIComponent(cleanHandle)}`;
    }
    if (cleanHandle.startsWith('http://') || cleanHandle.startsWith('https://')) {
      return cleanHandle;
    }
    return undefined;
  };

  const effectiveWhoisUrl =
    network.dn42WhoisUrl ||
    `https://explorer.burble.com/#/${encodeURIComponent(network.asn || 'AS4242423143')}`;

  return (
    <footer id="contact" className="w-full border-t border-white/10 bg-[#05070c] py-12 mt-12 text-xs text-slate-400 font-sans scroll-mt-20">
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        
        {/* Top: Compact Contact Matrix & Network Brand */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start border-b border-white/10 pb-10">
          
          {/* Left Brand Summary (4 Cols) */}
          <div className="lg:col-span-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-950/40 overflow-hidden shrink-0">
                <img
                  src={CURRENT_BRAND_LOGO}
                  alt={`${network.networkName} Logo`}
                  className="w-full h-full object-cover"
                />
              </div>
              <div>
                <div className="font-bold text-white text-base font-sans">{network.networkName}</div>
                <div className="text-xs text-cyan-400 font-mono font-semibold">{network.asn}</div>
              </div>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed font-sans">
              {network.description || `${network.networkName} is a non-profit DN42 routing experiment network operated by ${network.maintainer || 'DN42 Operator'}. Peering requests are welcome!`}
            </p>
          </div>

          {/* Right Contact Channels Grid (8 Cols) */}
          <div className="lg:col-span-8 space-y-3">
            <div className="flex items-center justify-between text-xs pb-1">
              <span className="font-bold text-white flex items-center gap-1.5 uppercase tracking-wider font-mono text-[11px] text-cyan-400">
                Contact Channels &middot; <span className="text-slate-500 font-sans">联络渠道</span>
              </span>
              <span className="text-slate-500 font-mono text-[11px]">SLA: Reply within 24h</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {contacts.map((item) => {
                const targetHref = resolveContactLink(item);
                return (
                  <div
                    key={item.platform}
                    className="p-3 rounded-xl bg-black/50 border border-white/10 hover:border-cyan-500/30 transition-all flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                        {getPlatformIcon(item.type, item.platform)}
                      </div>
                      <div className="overflow-hidden">
                        <div className="text-white text-xs font-semibold flex items-center gap-1">
                          <span>{item.platform}</span>
                          {item.preferred && (
                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
                          )}
                        </div>
                        <div className="font-mono text-[11px] text-slate-400 truncate">{item.handle}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => copyToClipboard(item.handle, item.platform)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                        title="Copy"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      {targetHref && (
                        <a
                          href={targetHref}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 transition-colors"
                          title="Open link"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Middle: Fast Links & Back to Top */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-5 text-xs font-mono">
            <a
              href={effectiveWhoisUrl}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
            >
              <span>DN42 WHOIS</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              type="button"
              onClick={onScrollToLookingGlass}
              className="text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-1 cursor-pointer bg-transparent border-0 p-0"
            >
              <span>Looking Glass</span>
            </button>
            <a
              href="https://dn42.dev"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
            >
              <span>DN42 Wiki</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <button
            onClick={scrollToTop}
            className="p-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 cursor-pointer text-xs"
            title="Back to top"
          >
            <span>Back to top</span>
            <ArrowUp className="w-3.5 h-3.5 text-cyan-400" />
          </button>
        </div>

        {/* Bottom: Copyright */}
        <div className="border-t border-white/5 pt-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-slate-500 text-[11px]">
          <div>
            &copy; {new Date().getFullYear()} {network.networkName} (Maintained by <span className="text-slate-400 font-semibold">{network.maintainer || 'Operator'}</span>). Licensed under{' '}
            <a
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:underline"
            >
              CC-BY-NC-SA 4.0
            </a>
            .
          </div>
          <div className="font-mono text-[11px] flex items-center gap-1 text-slate-400">
            <span>Powered by</span>
            <span className="text-cyan-400">BIRD 2 + WireGuard</span>
            <span>&middot; Built with React & Vite</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
