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
    // 3. Check for existing session on the same node for this ASN
    const sessions = await this.getSessions();
    const existingIndex = sessions.findIndex(s => s.asn === norm.asn && s.nodeId === norm.nodeId);
    const isNew = existingIndex === -1;

    let sessionId = '';
    if (isNew) {
      let registryInfo = null;
      try {
        registryInfo = await AuthService.getAsnRegistryInfo(norm.asn);
      } catch {
        // Fallback to AS tag if registry is offline/uninitialized
      }
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

    sessions.splice(sessionIndex, 1);
    await this.saveSessions(sessions);

    // Fire async Telegram deletion notification
    NotificationService.notifySessionDeletion(session).catch(() => {});

    return { success: true, message: `Session ${sessionId} removed successfully` };
  }

  /**
   * Update runtime state from probe merge (WireGuard metrics via pubkey, BGP state via Node + ASN)
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

    // 1. WireGuard Telemetry Correlation (Pubkey driven) - reference info only, NEVER determines status
    for (const peer of reportedPeers) {
      const session = sessions.find(s => s.nodeId === nodeId && s.peering?.publicKey === peer.publicKey);
      if (session) {
        if (!session.runtime) session.runtime = {};
        session.runtime.latestHandshake = peer.latestHandshake || session.runtime.latestHandshake || 0;
        session.runtime.endpoint = peer.endpoint || session.runtime.endpoint || '';
        session.runtime.rxBytes = peer.rxBytes || 0;
        session.runtime.txBytes = peer.txBytes || 0;
        updated = true;
      }
    }

    // 2. BGP Connectivity Correlation (Node + ASN driven) - Single source of truth for session status
    if (bgpSessions && bgpSessions.length > 0) {
      const nodeSessions = sessions.filter(s => s.nodeId === nodeId);
      for (const session of nodeSessions) {
        if (!session.runtime) session.runtime = {};
        const sessionAsn = session.asn;

        const bgp = bgpSessions.find(b => {
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
          // Node reported BGP sessions, but this ASN does not exist in birdc protocols
          session.runtime.bgpState = 'Pending';
          session.runtime.stageText = 'Awaiting BGP Config';
          if (session.status === 'active') {
            session.status = 'pending';
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
