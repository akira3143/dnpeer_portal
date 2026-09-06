import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config.js';
import { FileStore } from '../storage/fileStore.js';

class StatusTrackerService {
  constructor() {
    this.heartbeats = new Map();
    this.HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    this.loadedPath = null;
    this.saveTimer = null;
  }

  getCachePath() {
    return path.join(getDataDir(), 'status_cache.json');
  }

  ensureLoaded() {
    const cachePath = this.getCachePath();
    if (this.loadedPath === cachePath) return;
    this.loadedPath = cachePath;

    try {
      if (fs.existsSync(cachePath)) {
        const data = FileStore.readJsonSync(cachePath, {}) || {};
        for (const [nodeId, info] of Object.entries(data)) {
          const lastSeen = typeof info === 'string' ? info : info?.lastSeen;
          if (lastSeen) {
            const lastSeenTime = new Date(lastSeen).getTime();
            const isValid = !isNaN(lastSeenTime);
            if (isValid) {
              const elapsed = Date.now() - lastSeenTime;
              this.heartbeats.set(nodeId.trim(), {
                lastSeen,
                online: elapsed <= this.HEARTBEAT_TIMEOUT_MS
              });
            }
          }
        }
      }
    } catch {
      // Gracefully continue with in-memory map
    }
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveCache();
    }, 1000);
    if (typeof this.saveTimer?.unref === 'function') {
      this.saveTimer.unref();
    }
  }

  saveCache() {
    const cachePath = this.getCachePath();
    const data = {};
    for (const [nodeId, record] of this.heartbeats.entries()) {
      if (record?.lastSeen) {
        data[nodeId] = { lastSeen: record.lastSeen };
      }
    }
    try {
      FileStore.writeJsonSync(cachePath, data);
    } catch (err) {
      console.warn('[StatusTracker] Notice: Could not save status cache:', err.message);
    }
  }

  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveCache();
  }

  /**
   * Record a probe heartbeat from an edge node
   * @param {string} nodeId
   * @param {string} [timestamp]
   */
  recordHeartbeat(nodeId, timestamp) {
    if (!nodeId || typeof nodeId !== 'string') return;
    this.ensureLoaded();

    const now = timestamp || new Date().toISOString();
    const cleanId = nodeId.trim();
    this.heartbeats.set(cleanId, {
      lastSeen: now,
      online: true
    });

    const lower = cleanId.toLowerCase();
    this.heartbeats.set(lower, { lastSeen: now, online: true });
    this.heartbeats.set(lower.replace(/[^a-z0-9]/g, ''), { lastSeen: now, online: true });

    this.scheduleSave();
  }

  /**
   * Get real-time status of a node
   * @param {string} nodeId
   * @returns {{ online: boolean, lastSeen: string | null, status: 'online' | 'offline' }}
   */
  getNodeStatus(nodeId) {
    if (!nodeId) {
      return { online: false, lastSeen: null, status: 'offline' };
    }
    this.ensureLoaded();

    const norm = String(nodeId).trim();
    let record = this.heartbeats.get(norm);
    if (!record) {
      const lower = norm.toLowerCase();
      record = this.heartbeats.get(lower) || this.heartbeats.get(lower.replace(/[^a-z0-9]/g, ''));
    }
    if (!record) {
      const lower = norm.toLowerCase();
      const stripped = lower.replace(/[^a-z0-9]/g, '');
      for (const [k, v] of this.heartbeats.entries()) {
        const kLower = k.toLowerCase();
        if (kLower === lower || kLower.replace(/[^a-z0-9]/g, '') === stripped) {
          record = v;
          break;
        }
      }
    }

    if (!record || !record.lastSeen) {
      return { online: false, lastSeen: null, status: 'offline' };
    }

    const lastSeenTime = new Date(record.lastSeen).getTime();
    if (isNaN(lastSeenTime)) {
      return { online: false, lastSeen: null, status: 'offline' };
    }

    const elapsed = Date.now() - lastSeenTime;
    const isOnline = elapsed <= this.HEARTBEAT_TIMEOUT_MS;

    return {
      online: isOnline,
      lastSeen: record.lastSeen,
      status: isOnline ? 'online' : 'offline'
    };
  }

  /**
   * Boolean check if node is online
   * @param {string} nodeId
   * @returns {boolean}
   */
  isNodeOnline(nodeId) {
    return this.getNodeStatus(nodeId).online;
  }

  /**
   * Get status snapshot for a list of node definitions
   * @param {Array<{ id: string, code?: string }>} nodes
   */
  getProbesMap(nodes = []) {
    this.ensureLoaded();
    const probes = {};
    for (const node of nodes) {
      const status = this.getNodeStatus(node.id);
      probes[node.id] = status;
      if (node.id) {
        probes[node.id.toLowerCase()] = status;
        probes[node.id.toLowerCase().replace(/[^a-z0-9]/g, '')] = status;
      }
      if (node.code) {
        probes[node.code] = status;
        probes[node.code.toLowerCase()] = status;
        probes[node.code.toLowerCase().replace(/[^a-z0-9]/g, '')] = status;
      }
    }
    for (const [k, v] of this.heartbeats.entries()) {
      if (!probes[k]) {
        probes[k] = this.getNodeStatus(k);
      }
    }
    return probes;
  }

  /**
   * Clear all heartbeat records (used in test teardown)
   */
  reset() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.heartbeats.clear();
    const cachePath = this.getCachePath();
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
    } catch {}
    this.loadedPath = null;
  }
}

export const StatusTracker = new StatusTrackerService();


