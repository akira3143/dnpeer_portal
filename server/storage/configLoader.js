import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CONFIG_YAML_PATH, DATA_DIR } from '../config.js';
import { FileStore } from './fileStore.js';

const DEFAULT_CONFIG = {
  guiPath: '/gui',
  network: {
    asn: 'AS4242423143',
    asnNumber: 4242423143,
    networkName: 'AkiLab DN42 Network',
    shortName: 'akilab',
    tagline: 'High Performance DN42 Experimental Autonomous System',
    description: 'AkiLab DN42 backbone nodes with MP-BGP Extended Next Hop.',
    maintainer: 'AKIRA-MNT',
    ipv4Pool: '172.20.150.0/24',
    ipv6Pool: 'fd00:4242:3143::/48',
    routingPolicy: 'Open for all DN42 participants / MP-BGP (ENH) / Strict ROA Validation',
    bgpMode: 'MP-BGP + Extended Next Hop (ENH)',
    portFormulaDisplay: '20000 + (ASN % 10000) [Auto-increments +10000 on conflict]',
    lookingGlassUrl: 'https://lg.akilab.dn42',
    dn42WhoisUrl: 'https://explorer.burble.com/#/AS4242423143',
    lastUpdated: new Date().toISOString().slice(0, 10)
  },
  nodes: [
    {
      id: 'JP-TYO-1',
      code: 'JP-1',
      name: 'Tokyo Hub 01',
      flag: '🇯🇵',
      city: 'Tokyo',
      country: 'Japan',
      region: 'apac',
      status: 'active',
      isp: 'AkiLab Datacenter Tokyo',
      endpointDomain: 'jp1.akilab.dn42',
      wgPublicKey: 'akilab_tokyo_wg_pubkey_replace_in_config_111111=',
      tunnelIpv4: '172.20.150.1',
      tunnelIpv6ULA: 'fd00:4242:3143::1',
      tunnelIpv6LLA: 'fe80::3143',
      mtu: 1420,
      features: ['Core Hub', 'MP-BGP', 'ENH'],
      lgProxyUrl: 'http://127.0.0.1:5000'
    },
    {
      id: 'US-SJC-1',
      code: 'US-1',
      name: 'Silicon Valley 01',
      flag: '🇺🇸',
      city: 'San Jose',
      country: 'United States',
      region: 'na',
      status: 'active',
      isp: 'AkiLab Datacenter US-West',
      endpointDomain: 'us1.akilab.dn42',
      wgPublicKey: 'akilab_sjc_wg_pubkey_replace_in_config_2222222=',
      tunnelIpv4: '172.20.150.2',
      tunnelIpv6ULA: 'fd00:4242:3143::2',
      tunnelIpv6LLA: 'fe80::3143',
      mtu: 1420,
      features: ['MP-BGP', 'ENH', 'Trans-Pacific'],
      lgProxyUrl: 'http://127.0.0.1:5001'
    }
  ],
  contacts: [
    {
      platform: 'Telegram',
      handle: '@akira_dn42',
      link: 'https://t.me/akira_dn42',
      type: 'telegram',
      preferred: true
    }
  ],
  admins: [4242423143]
};

let cachedConfig = null;
let watcherInitialized = false;
let watcherInstance = null;
let reloadTimer = null;

export function loadPortalConfig() {
  FileStore.ensureDirectory(DATA_DIR);

  try {
    if (fs.existsSync(CONFIG_YAML_PATH)) {
      const raw = fs.readFileSync(CONFIG_YAML_PATH, 'utf8');
      const parsed = yaml.load(raw);
      if (parsed && typeof parsed === 'object') {
        cachedConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          network: { ...DEFAULT_CONFIG.network, ...(parsed.network || {}) },
          guiPath: parsed.guiPath || DEFAULT_CONFIG.guiPath,
          nodes: Array.isArray(parsed.nodes) ? parsed.nodes : DEFAULT_CONFIG.nodes,
          contacts: Array.isArray(parsed.contacts) ? parsed.contacts : DEFAULT_CONFIG.contacts,
          admins: Array.isArray(parsed.admins) ? parsed.admins : DEFAULT_CONFIG.admins
        };
        return cachedConfig;
      }
    }
  } catch (err) {
    console.error(`[ConfigLoader] Failed to parse ${CONFIG_YAML_PATH}:`, err.message);
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

export function getActiveConfig() {
  if (!cachedConfig) {
    loadPortalConfig();
  }
  return cachedConfig;
}

export function initConfigWatcher() {
  if (watcherInitialized) return;
  watcherInitialized = true;

  loadPortalConfig();

  const configDir = path.dirname(CONFIG_YAML_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  try {
    watcherInstance = fs.watch(configDir, (eventType, filename) => {
      if (filename && filename.includes('portal.config')) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          console.log('[ConfigLoader] portal.config changed, hot reloading configuration...');
          loadPortalConfig();
        }, 200);
      }
    });
    // Unref so watcher does not keep process alive during unit tests
    if (typeof watcherInstance?.unref === 'function') {
      watcherInstance.unref();
    }
  } catch (err) {
    console.warn('[ConfigLoader] Could not watch config file:', err.message);
  }
}

export function stopConfigWatcher() {
  if (reloadTimer) {
    clearTimeout(reloadTimer);
    reloadTimer = null;
  }
  if (watcherInstance) {
    try {
      watcherInstance.close();
    } catch {}
    watcherInstance = null;
  }
  watcherInitialized = false;
}
