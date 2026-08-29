import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from '../config.js';
import { FileStore } from '../storage/fileStore.js';
import { getActiveConfig } from '../storage/configLoader.js';
import { validatePeeringSubmission } from '../utils/validator.js';
import { PortLedgerService } from './portLedgerService.js';
import { ConfigEngine } from './configEngine.js';
import { AuthService } from './authService.js';
import { NotificationService } from './notificationService.js';

export class SessionService {
  static getSessionsPath() {
    return path.join(DATA_DIR, 'peering_sessions.json');
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
   * Authoritative Peer Submission: Validates, assigns port, generates configs, persists session
   */
  static async submitPeering(rawPayload) {
    // 1. Authoritative Format Validation
    const valRes = validatePeeringSubmission(rawPayload);
    if (!valRes.valid) {
      return {
        success: false,
        fieldErrors: valRes.fieldErrors,
        message: 'Validation failed. Please check field inputs.'
      };
    }

    const norm = valRes.normalized;

    // 2. Validate Node ID against active configuration
    const config = getActiveConfig();
    const targetNode = config.nodes.find(n => n.id === norm.nodeId);
    if (!targetNode) {
      return {
        success: false,
        fieldErrors: { nodeId: `Node ${norm.nodeId} does not exist` },
        message: `Node ${norm.nodeId} does not exist`
      };
    }

    // 3. Check for existing session on the same node for this ASN
    const sessions = await this.getSessions();
    const existingIndex = sessions.findIndex(s => s.asn === norm.asn && s.nodeId === norm.nodeId);
    const isNew = existingIndex === -1;
    const sessionId = isNew
      ? `sess_${norm.asn}_${norm.nodeId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
      : sessions[existingIndex].id;

    // 4. Atomic Port Verdict
    const portResult = await PortLedgerService.allocateAndLockPort({
      nodeId: norm.nodeId,
      asn: norm.asn,
      requestedPort: norm.listenPort,
      sessionId,
      description: `Peering for AS${norm.asn}`
    });

    // 5. Generate Configuration Finished Products
    const generatedConfigs = ConfigEngine.generateFullConfig({
      asn: norm.asn,
      nodeId: norm.nodeId,
      clientPublicKey: norm.publicKey,
      clientEndpoint: norm.endpoint,
      clientIpv4: norm.ipv4,
      clientIpv6Ula: norm.ipv6Ula,
      clientLinkLocal: norm.linkLocal,
      hostPort: portResult.port,
      mtu: norm.mtu,
      bgpMode: norm.bgpMode
    });

    // 6. Fetch Registry AS Name if available
    const registryInfo = await AuthService.getAsnRegistryInfo(norm.asn);

    const now = new Date().toISOString();
    const newSession = {
      id: sessionId,
      asn: norm.asn,
      asName: registryInfo.asName || `AS${norm.asn}`,
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
        mtu: norm.mtu,
        bgpMode: norm.bgpMode
      },
      assigned: {
        hostPort: portResult.port,
        isShifted: portResult.isShifted,
        expectedPort: portResult.expectedPort,
        serverEndpoint: generatedConfigs.serverEndpoint,
        serverPublicKey: generatedConfigs.serverPublicKey,
        serverIpv4: generatedConfigs.serverIpv4,
        serverIpv6Ula: generatedConfigs.serverIpv6Ula,
        serverLinkLocal: generatedConfigs.serverLinkLocal
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

    return {
      success: true,
      data: {
        sessionId: newSession.id,
        session: newSession,
        port: portResult.port,
        isShifted: portResult.isShifted,
        expectedPort: portResult.expectedPort,
        conflictMessage,
        configs: generatedConfigs,
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

    return { success: true, message: `Session ${sessionId} removed successfully` };
  }

  /**
   * Update runtime state from probe merge
   */
  static async updateRuntimePeers(nodeId, reportedPeers = []) {
    const sessions = await this.getSessions();
    let updated = false;

    for (const peer of reportedPeers) {
      // Find matching session by public key on this node
      const session = sessions.find(s => s.nodeId === nodeId && s.peering?.publicKey === peer.publicKey);
      if (session) {
        if (!session.runtime) session.runtime = {};
        session.runtime.latestHandshake = peer.latestHandshake || session.runtime.latestHandshake || 0;
        session.runtime.endpoint = peer.endpoint || session.runtime.endpoint || '';
        session.runtime.rxBytes = peer.rxBytes || 0;
        session.runtime.txBytes = peer.txBytes || 0;

        if (session.runtime.latestHandshake > 0) {
          session.runtime.stage = 3; // WireGuard handshake active
          session.runtime.stageText = 'WireGuard Handshake Active';
          session.status = 'active';
        }
        updated = true;
      }
    }

    if (updated) {
      await this.saveSessions(sessions);
    }
  }
}
