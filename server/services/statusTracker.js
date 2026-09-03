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
    this.heartbeats.set(nodeId.trim(), {
      lastSeen: now,
      online: true
    });
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

    const record = this.heartbeats.get(nodeId.trim());
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
      if (node.code) {
        probes[node.code] = status;
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


