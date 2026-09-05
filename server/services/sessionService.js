import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from '../config.js';
import { FileStore } from '../storage/fileStore.js';
import { getActiveConfig } from '../storage/configLoader.js';
import { validatePeeringSubmission } from '../utils/validator.js';
import { PortLedgerService } from './portLedgerService.js';
import { ConfigEngine } from './configEngine.js';
import { AuthService } from './authService.js';
import { NotificationService } from './notificationService.js';

// In-process commit mutex: serializes the read-modify-write session table cycle
// (getSessions -> mutate -> saveSessions) so concurrent submissions cannot
// overwrite each other with stale table snapshots.
const sessionCommitQueues = new Map();

/**
 * Extract IPv4, IPv6 ULA, and Link-Local addresses from WireGuard AllowedIPs string
 */
export function parseAllowedIps(allowedIpsStr = '') {
  const result = { ipv4: '', ipv6Ula: '', linkLocal: '' };
  if (!allowedIpsStr || typeof allowedIpsStr !== 'string') return result;

  const parts = allowedIpsStr.split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    const cleanIp = part.replace(/\/\d+$/, '');
    if (/^(?:172\.(?:2[0-9]|3[0-1])|10\.)/.test(cleanIp) || /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) {
      if (!result.ipv4) result.ipv4 = cleanIp;
    } else if (/^fe80:/i.test(cleanIp)) {
      if (!result.linkLocal) result.linkLocal = cleanIp;
    } else if (/^fd[0-9a-fA-F:]+/i.test(cleanIp)) {
      if (!result.ipv6Ula) result.ipv6Ula = cleanIp;
    }
  }
  return result;
}

export class SessionService {
  static withSessionCommitLock(fn) {
    const key = 'sessions';
    const prev = sessionCommitQueues.get(key) || Promise.resolve();
    const next = prev.then(() => fn());
    sessionCommitQueues.set(key, next.catch(() => {}));
    return next;
  }

  static getSessionsPath() {
    return path.join(getDataDir(), 'peering_sessions.json');
  }

  static async getSessions() {
    const filePath = this.getSessionsPath();
    const sessions = await FileStore.readJson(filePath, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  static async saveSessions(sessions) {
    const filePath = this.getSessionsPath();
    return FileStore.writeJson(filePath, sessions);
  }

  static getIgnoredPeersPath() {
    return path.join(getDataDir(), 'ignored_peers.json');
  }

  static async getIgnoredPeers() {
    const filePath = this.getIgnoredPeersPath();
    const list = await FileStore.readJson(filePath, []);
    return Array.isArray(list) ? list : [];
  }

  static async saveIgnoredPeers(list) {
    const filePath = this.getIgnoredPeersPath();
    return FileStore.writeJson(filePath, list);
  }

  static async isPeerIgnored(nodeId, publicKey) {
    if (!publicKey || !nodeId) return false;
    const list = await this.getIgnoredPeers();
    const normKey = publicKey.trim();
    return list.some(item => item.nodeId === nodeId && item.publicKey === normKey);
  }

  static async addIgnoredPeer(nodeId, publicKey, reason = 'removed_by_user') {
    if (!publicKey || !nodeId) return false;
    const list = await this.getIgnoredPeers();
    const normKey = publicKey.trim();
    if (!list.some(item => item.nodeId === nodeId && item.publicKey === normKey)) {
      list.push({
        nodeId,
        publicKey: normKey,
        ignoredAt: new Date().toISOString(),
        reason
      });
      await this.saveIgnoredPeers(list);
    }
    return true;
  }

  static async getSessionById(id) {
    const sessions = await this.getSessions();
    return sessions.find(s => s.id === id) || null;
  }

  static async getSessionsByAsn(asn, isAdmin = false) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const sessions = await this.getSessions();
    if (isAdmin) {
      return sessions;
    }
    return sessions.filter(s => s.asn === cleanAsn);
  }

  /**
   * Authoritative Peer Submission: Validates, assigns server port, generates configs, persists session
   */
  static async submitPeering(rawPayload) {
    // ---- Lock-free phase: validation, node lookup, registry fetch ----
    const valRes = validatePeeringSubmission(rawPayload);
    if (!valRes.valid) {
      return {
        success: false,
        fieldErrors: valRes.fieldErrors,
        message: 'Validation failed. Please check field inputs.'
      };
    }

    const norm = valRes.normalized;

    const config = getActiveConfig();
    const targetNode = config.nodes.find(n => n.id === norm.nodeId);
    if (!targetNode) {
      return {
        success: false,
        fieldErrors: { nodeId: `Node ${norm.nodeId} does not exist` },
        message: `Node ${norm.nodeId} does not exist`
      };
    }

    let registryInfo = null;
    try {
      registryInfo = await AuthService.getAsnRegistryInfo(norm.asn);
    } catch {
      // Fallback to AS tag if registry is offline/uninitialized
    }

    // ---- Serialized commit phase: read-modify-write of the session table ----
    return this.withSessionCommitLock(() =>
      this._commitSession({ norm, rawPayload, targetNode, config, registryInfo })
    );
  }

  static async _commitSession({ norm, rawPayload, targetNode, config, registryInfo }) {
    // 3. Check for existing session on the same node for this ASN or matching WireGuard pubkey
    const sessions = await this.getSessions();
    let existingIndex = sessions.findIndex(s => s.asn === norm.asn && s.nodeId === norm.nodeId);
    if (existingIndex === -1 && norm.publicKey) {
      existingIndex = sessions.findIndex(s => s.nodeId === norm.nodeId && s.peering?.publicKey === norm.publicKey);
    }
    const isDiscovered = existingIndex !== -1 && sessions[existingIndex].source === 'discovered';
    const isNew = existingIndex === -1 || isDiscovered;

    // Clear any tombstone for this public key if it was previously ignored
    if (norm.publicKey) {
      const ignoredList = await this.getIgnoredPeers();
      const filtered = ignoredList.filter(item => !(item.nodeId === norm.nodeId && item.publicKey === norm.publicKey));
      if (filtered.length !== ignoredList.length) {
        await this.saveIgnoredPeers(filtered);
      }
    }

    let sessionId = '';
    if (isNew) {
      let mntTag = '';
      if (registryInfo?.maintainer) {
        mntTag = registryInfo.maintainer.replace(/-(?:MNT|DN42)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      }
      if (!mntTag && registryInfo?.asName) {
        mntTag = registryInfo.asName.replace(/-(?:MNT|DN42)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      }
      if (!mntTag) {
        mntTag = `as${norm.asn}`;
      }
      const nodeTag = norm.nodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
      sessionId = `peer_${mntTag}_${nodeTag}`;
    } else {
      sessionId = sessions[existingIndex].id;
    }

    // 4. Atomic Port Verdict (Server HostPort)
    const portResult = await PortLedgerService.allocateAndLockPort({
      nodeId: norm.nodeId,
      asn: norm.asn,
      requestedPort: norm.listenPort,
      sessionId,
      description: `Peering for AS${norm.asn}`
    });

    // 4b. Verdict for Client ListenPort (clientPort)
    // DN42 convention: 20000 + (ourAsn % 10000). For AkiLab AS4242423143 => 23143
    const ourAsn = config.network?.asnNumber || 4242423143;
    const baseClientPort = 20000 + (ourAsn % 10000);
    let allocatedClientPort;
    let clientPortShifted = false;

    const customClientPortNum = parseInt(norm.clientPort, 10);
    if (!isNaN(customClientPortNum) && norm.clientPort !== 'auto') {
      allocatedClientPort = customClientPortNum;
      clientPortShifted = false;
    } else {
      // Auto allocation: avoid collision with other sessions using the SAME wireguard public key
      const sameKeySessions = sessions.filter(s => s.id !== sessionId && s.peering?.publicKey === norm.publicKey);
      const occupiedPorts = new Set(
        sameKeySessions.map(s => parseInt(s.assigned?.clientPort || s.peering?.clientPort, 10)).filter(p => !isNaN(p))
      );

      let portCandidate = baseClientPort;
      while (occupiedPorts.has(portCandidate)) {
        portCandidate += 10000;
        clientPortShifted = true;
        if (portCandidate > 65535) {
          portCandidate = 20000 + ((portCandidate - 20000) % 45536);
        }
      }
      allocatedClientPort = portCandidate;
    }

    // 5. Generate Configuration Finished Products (Dual port: server hostPort & clientPort)
    const generatedConfigs = ConfigEngine.generateFullConfig({
      asn: norm.asn,
      nodeId: norm.nodeId,
      clientPublicKey: norm.publicKey,
      clientEndpoint: norm.endpoint,
      clientIpv4: norm.ipv4,
      clientIpv6Ula: norm.ipv6Ula,
      clientLinkLocal: norm.linkLocal,
      hostPort: portResult.port,
      clientPort: allocatedClientPort,
      mtu: norm.mtu,
      bgpMode: norm.bgpMode
    });

    // 6. Registry AS Name (already fetched in the lock-free phase)
    const now = new Date().toISOString();
    const newSession = {
      id: sessionId,
      source: 'portal',
      asn: norm.asn,
      asName: registryInfo?.asName || `AS${norm.asn}`,
      mnt: AuthService.simplifyMnt(registryInfo?.maintainer) || '',
      nodeId: norm.nodeId,
      status: 'pending',
      createdAt: isNew ? now : sessions[existingIndex].createdAt,
      updatedAt: now,
      contact: rawPayload.contact || '',
      peering: {
        publicKey: norm.publicKey,
        endpoint: norm.endpoint,
        ipv4: norm.ipv4,
        ipv6Ula: norm.ipv6Ula,
        linkLocal: norm.linkLocal,
        listenPort: portResult.port,
        clientPort: allocatedClientPort,
        clientPortShifted,
        mtu: norm.mtu,
        bgpMode: norm.bgpMode
      },
      assigned: {
        hostPort: portResult.port,
        isShifted: portResult.isShifted,
        expectedPort: portResult.expectedPort,
        clientPort: allocatedClientPort,
        isClientPortShifted: clientPortShifted,
        expectedClientPort: baseClientPort,
        serverEndpoint: generatedConfigs.serverEndpoint,
        serverPublicKey: generatedConfigs.serverPublicKey,
        serverIpv4: generatedConfigs.serverIpv4,
        serverIpv6Ula: generatedConfigs.serverIpv6Ula,
        serverLinkLocal: generatedConfigs.serverLinkLocal,
        serverWireguardSnippet: generatedConfigs.serverWireguardSnippet
      },
      runtime: isNew ? {
        stage: 1,
        stageText: 'Awaiting admin configuration',
        latestHandshake: 0,
        bgpState: 'Idle'
      } : sessions[existingIndex].runtime
    };

    if (isNew) {
      sessions.push(newSession);
    } else {
      sessions[existingIndex] = newSession;
    }

    await this.saveSessions(sessions);

    // 7. Fire async Telegram notification
    NotificationService.notifyPeeringSubmission(newSession, isNew).catch(() => {});

    let conflictMessage = null;
    if (portResult.isShifted) {
      if (norm.listenPort && norm.listenPort !== 'auto') {
        conflictMessage = `Requested ${portResult.expectedPort} was taken, assigned ${portResult.port} instead.`;
      } else {
        conflictMessage = `Default ${portResult.expectedPort} was taken, assigned ${portResult.port} instead.`;
      }
    }

    let clientConflictMessage = null;
    if (clientPortShifted) {
      clientConflictMessage = `Default client ListenPort ${baseClientPort} was in use on this key, assigned ${allocatedClientPort} instead.`;
    }

    return {
      success: true,
      data: {
        sessionId: newSession.id,
        session: newSession,
        port: portResult.port,
        isShifted: portResult.isShifted,
        expectedPort: portResult.expectedPort,
        conflictMessage,
        clientPort: allocatedClientPort,
        isClientPortShifted: clientPortShifted,
        expectedClientPort: baseClientPort,
        clientConflictMessage,
        configs: generatedConfigs,
        clientWireguard: generatedConfigs.clientWireguard,
        acknowledgement: "Received your peering info. We'll establish the peer with you within 24 hours!"
      }
    };
  }

  /**
   * Delete peering session & release port
   */
  static async deleteSession(sessionId, requesterAsn, isAdmin = false) {
    const sessions = await this.getSessions();
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);

    if (sessionIndex === -1) {
      return { success: false, message: 'Session not found' };
    }

    const session = sessions[sessionIndex];
    if (!isAdmin && session.asn !== requesterAsn) {
      return { success: false, message: 'Unauthorized to delete this session' };
    }

    // Release port in ledger
    await PortLedgerService.releaseSessionPort(session.nodeId, sessionId);

    // Record tombstone if session has a WireGuard public key (prevents probe resurrection)
    if (session.peering?.publicKey) {
      await this.addIgnoredPeer(
        session.nodeId,
        session.peering.publicKey,
        session.source === 'discovered' ? 'discovered_deleted' : 'session_deleted'
      );
    }

    sessions.splice(sessionIndex, 1);
    await this.saveSessions(sessions);

    // Fire async Telegram deletion notification only for portal-managed sessions
    if (session.source !== 'discovered') {
      NotificationService.notifySessionDeletion(session).catch(() => {});
    }

    return { success: true, message: `Session ${sessionId} removed successfully` };
  }

  /**
   * Update runtime state from probe merge (WireGuard metrics via pubkey, BGP state via Node + ASN)
   * Includes Round 25 auto-discovery for stock pre-existing peers (source: 'discovered').
   */
  static async updateRuntimePeers(nodeId, reportedData = [], optionalBgpSessions = []) {
    const sessions = await this.getSessions();
    let updated = false;

    let reportedPeers = [];
    let bgpSessions = [];
    if (Array.isArray(reportedData)) {
      reportedPeers = reportedData;
      bgpSessions = Array.isArray(optionalBgpSessions) ? optionalBgpSessions : [];
    } else if (reportedData && typeof reportedData === 'object') {
      reportedPeers = Array.isArray(reportedData.peers) ? reportedData.peers : [];
      bgpSessions = Array.isArray(reportedData.bgpSessions) ? reportedData.bgpSessions : [];
    }

    // 1. WireGuard Telemetry Correlation (Pubkey driven) for existing sessions
    for (const peer of reportedPeers) {
      const session = sessions.find(s => s.nodeId === nodeId && s.peering?.publicKey === peer.publicKey);
      if (session) {
        if (!session.runtime) session.runtime = {};
        session.runtime.latestHandshake = peer.latestHandshake || session.runtime.latestHandshake || 0;
        session.runtime.endpoint = peer.endpoint || session.runtime.endpoint || '';
        session.runtime.rxBytes = peer.rxBytes || 0;
        session.runtime.txBytes = peer.txBytes || 0;
        if (peer.interface) {
          session.peering = session.peering || {};
          session.peering.interface = peer.interface;
        }
        if (session.source === 'discovered' && peer.allowedIps) {
          session.peering = session.peering || {};
          const parsed = parseAllowedIps(peer.allowedIps);
          if (!session.peering.ipv4 && parsed.ipv4) session.peering.ipv4 = parsed.ipv4;
          if (!session.peering.ipv6Ula && parsed.ipv6Ula) session.peering.ipv6Ula = parsed.ipv6Ula;
          if (!session.peering.linkLocal && parsed.linkLocal) session.peering.linkLocal = parsed.linkLocal;
          session.peering.allowedIps = peer.allowedIps;
        }
        updated = true;
      }
    }

    // 2. Stock Peer Auto-Discovery (Round 25, 方案 A)
    // For reported real peers whose pubkey does not match any existing session on this node:
    for (const peer of reportedPeers) {
      if (!peer.publicKey) continue;
      const existing = sessions.find(s => s.nodeId === nodeId && s.peering?.publicKey === peer.publicKey);
      if (existing) continue;

      // Check if peer has been tombstoned/ignored on this node
      if (await this.isPeerIgnored(nodeId, peer.publicKey)) {
        continue;
      }

      // Correlate ASN from BGP data
      let matchedAsn = null;
      let matchedBgp = null;

      if (bgpSessions && bgpSessions.length > 0) {
        // Priority 1: Match BGP session by interface name
        if (peer.interface) {
          matchedBgp = bgpSessions.find(b =>
            b.name && (
              b.name.toLowerCase() === peer.interface.toLowerCase() ||
              b.name.toLowerCase().includes(peer.interface.toLowerCase()) ||
              peer.interface.toLowerCase().includes(b.name.toLowerCase())
            )
          );

          // Priority 2: Extract ASN digits from interface name (e.g. dn42_3143 or as4242423143)
          if (!matchedBgp) {
            const m = peer.interface.match(/(?:as|asn|peer|p|dn42|_|^)(\d{4,10})/i);
            if (m) {
              const parsedNum = parseInt(m[1], 10);
              const targetAsn = (parsedNum < 10000 && parsedNum > 0) ? (4242420000 + parsedNum) : parsedNum;
              matchedBgp = bgpSessions.find(b => b.asn === targetAsn || b.cleanAsn === targetAsn || b.asn === parsedNum);
              if (!matchedBgp) {
                matchedAsn = targetAsn;
              }
            }
          }
        }

        // Priority 3: If still unmatched, check if there's an unused BGP session on this node
        if (!matchedBgp && !matchedAsn) {
          const usedAsns = new Set(sessions.filter(s => s.nodeId === nodeId && s.asn).map(s => s.asn));
          const candidateBgp = bgpSessions.filter(b => (b.cleanAsn || b.asn) && !usedAsns.has(b.cleanAsn || b.asn));
          if (candidateBgp.length === 1) {
            matchedBgp = candidateBgp[0];
          }
        }
      }

      if (matchedBgp) {
        matchedAsn = matchedBgp.cleanAsn || matchedBgp.asn || matchedAsn;
      }

      const parsedAddrs = parseAllowedIps(peer.allowedIps || '');
      const nodeTag = nodeId.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const pubShort = peer.publicKey.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
      const baseId = matchedAsn ? `disc_${nodeTag}_as${matchedAsn}` : `disc_${nodeTag}_${pubShort}`;
      let discId = baseId;
      let counter = 1;
      while (sessions.some(s => s.id === discId)) {
        discId = `${baseId}_${counter++}`;
      }

      const now = new Date().toISOString();
      const newDiscSession = {
        id: discId,
        source: 'discovered',
        asn: matchedAsn || null,
        asName: matchedAsn ? `AS${matchedAsn}` : 'Unknown Peer',
        mnt: '',
        nodeId: nodeId,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        contact: '',
        peering: {
          publicKey: peer.publicKey,
          endpoint: peer.endpoint || '',
          ipv4: parsedAddrs.ipv4 || '',
          ipv6Ula: parsedAddrs.ipv6Ula || '',
          linkLocal: parsedAddrs.linkLocal || '',
          listenPort: null,
          clientPort: null,
          interface: peer.interface || '',
          allowedIps: peer.allowedIps || '',
          mtu: 1420
        },
        assigned: {
          hostPort: null,
          interface: peer.interface || ''
        },
        runtime: {
          stage: 1,
          stageText: 'Discovered peer',
          latestHandshake: peer.latestHandshake || 0,
          endpoint: peer.endpoint || '',
          rxBytes: peer.rxBytes || 0,
          txBytes: peer.txBytes || 0,
          bgpState: 'Pending'
        }
      };

      sessions.push(newDiscSession);
      updated = true;
    }

    // 3. BGP Connectivity Correlation (Node + ASN driven) - Single source of truth for session status
    if (bgpSessions && bgpSessions.length > 0) {
      const nodeSessions = sessions.filter(s => s.nodeId === nodeId);
      for (const session of nodeSessions) {
        if (!session.runtime) session.runtime = {};
        const sessionAsn = session.asn;

        let bgp = null;
        if (sessionAsn) {
          bgp = bgpSessions.find(b => {
            if (b.asn && sessionAsn) {
              if (b.asn === sessionAsn) return true;
              if (b.cleanAsn === sessionAsn) return true;
              if (sessionAsn % 10000 === b.asn) return true;
              if (sessionAsn % 100000 === b.asn) return true;
            }
            if (b.name && sessionAsn) {
              const strAsn = String(sessionAsn);
              const strTail = String(sessionAsn % 10000);
              if (b.name.includes(strAsn) || b.name.includes(strTail)) return true;
            }
            return false;
          });
        } else if (session.source === 'discovered' && session.peering?.interface) {
          bgp = bgpSessions.find(b =>
            b.name && (
              b.name.toLowerCase() === session.peering.interface.toLowerCase() ||
              b.name.toLowerCase().includes(session.peering.interface.toLowerCase()) ||
              session.peering.interface.toLowerCase().includes(b.name.toLowerCase())
            )
          );
          if (bgp && (bgp.cleanAsn || bgp.asn)) {
            session.asn = bgp.cleanAsn || bgp.asn;
            session.asName = `AS${session.asn}`;
          }
        }

        if (bgp) {
          // BGP state transparent pass-through
          session.runtime.bgpState = bgp.bgpState;
          session.runtime.bgpInfo = bgp.info;
          session.runtime.bgpProtocolName = bgp.name;
          const normState = (bgp.bgpState || '').toLowerCase();

          if (normState === 'established') {
            session.status = 'active';
            session.runtime.stage = 3;
            session.runtime.stageText = 'BGP Established';
          } else if (normState === 'connect') {
            session.status = 'connect';
            session.runtime.stage = 2;
            session.runtime.stageText = 'BGP Connect';
          } else if (normState === 'active') {
            session.status = 'connect';
            session.runtime.stage = 2;
            session.runtime.stageText = 'BGP Active';
          } else if (normState === 'idle') {
            session.status = 'idle';
            session.runtime.stage = 1;
            session.runtime.stageText = (session.runtime.latestHandshake > 0)
              ? 'BGP Idle (WG Handshake OK)'
              : 'BGP Idle';
          } else {
            session.status = normState || 'pending';
            session.runtime.stage = 2;
            session.runtime.stageText = `BGP ${bgp.bgpState}`;
          }
          updated = true;
        } else {
          session.runtime.bgpState = 'Pending';
          if (session.source === 'discovered') {
            session.runtime.stageText = session.runtime.latestHandshake > 0
              ? 'Discovered (Handshake OK, No BGP)'
              : 'Discovered (Awaiting BGP)';
            session.status = 'pending';
          } else {
            session.runtime.stageText = 'Awaiting BGP Config';
            if (session.status === 'active') {
              session.status = 'pending';
            }
          }
          updated = true;
        }
      }
    }

    if (updated) {
      await this.saveSessions(sessions);
    }
  }
}
