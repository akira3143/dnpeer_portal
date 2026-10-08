import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../config.js';
import { FileStore } from '../storage/fileStore.js';

export class SessionTelemetryManager {
  static _telemetryMap = new Map();
  static _loadedPath = null;
  static _saveTimer = null;
  static _savePromise = null;
  static _isDirty = false;

  static getTelemetryPath() {
    return path.join(getDataDir(), 'session_telemetry.json');
  }

  static _normalizeRecord(item) {
    if (!item || typeof item !== 'object') {
      return {
        stage: 1,
        stageText: 'pending',
        latestHandshake: 0,
        endpoint: '',
        rxBytes: 0,
        txBytes: 0,
        rx24h: 0,
        tx24h: 0,
        bgpState: 'Pending',
        bgpInfo: '',
        bgpProtocolName: '',
        trafficSeries: []
      };
    }

    const series = Array.isArray(item.trafficSeries)
      ? item.trafficSeries.map(p => {
          if (Array.isArray(p)) {
            return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
          }
          if (p && typeof p === 'object') {
            return [Number(p.t) || 0, Number(p.rx) || 0, Number(p.tx) || 0];
          }
          return null;
        }).filter(Boolean)
      : [];

    return {
      stage: typeof item.stage === 'number' ? item.stage : 1,
      stageText: item.stageText || 'pending',
      status: item.status || undefined,
      latestHandshake: item.latestHandshake || 0,
      endpoint: item.endpoint || '',
      rxBytes: item.rxBytes || 0,
      txBytes: item.txBytes || 0,
      rx24h: item.rx24h ?? item.rxBytes ?? 0,
      tx24h: item.tx24h ?? item.txBytes ?? 0,
      bgpState: item.bgpState || 'Pending',
      bgpInfo: item.bgpInfo || '',
      bgpProtocolName: item.bgpProtocolName || '',
      trafficSeries: series
    };
  }

  static ensureLoaded() {
    const currentPath = this.getTelemetryPath();
    if (this._loadedPath === currentPath) {
      return;
    }

    this._telemetryMap = new Map();
    this._loadedPath = currentPath;
    this._isDirty = false;

    try {
      if (fs.existsSync(currentPath)) {
        const raw = FileStore.readJsonSync(currentPath, null);
        const data = raw?.sessions || raw || {};
        for (const [id, item] of Object.entries(data)) {
          if (item && typeof item === 'object') {
            this._telemetryMap.set(id, this._normalizeRecord(item));
          }
        }
      }
    } catch (err) {
      console.warn('[SessionTelemetryManager] Notice: Could not load telemetry file:', err.message);
    }
  }

  static getTelemetry(sessionId) {
    if (!sessionId) return null;
    this.ensureLoaded();
    const rec = this._telemetryMap.get(sessionId);
    if (!rec) return null;

    return {
      stage: rec.stage,
      stageText: rec.stageText,
      status: rec.status,
      latestHandshake: rec.latestHandshake,
      endpoint: rec.endpoint,
      rxBytes: rec.rxBytes,
      txBytes: rec.txBytes,
      rx24h: rec.rx24h,
      tx24h: rec.tx24h,
      bgpState: rec.bgpState,
      bgpInfo: rec.bgpInfo,
      bgpProtocolName: rec.bgpProtocolName,
      trafficSeries: rec.trafficSeries.map(p => ({ t: p[0], rx: p[1], tx: p[2] }))
    };
  }

  static setTelemetry(sessionId, data, status = undefined) {
    if (!sessionId || !data) return;
    this.ensureLoaded();

    const existing = this._telemetryMap.get(sessionId) || {};
    const normalized = this._normalizeRecord({
      ...existing,
      ...data,
      status: status || data.status || existing.status
    });

    this._telemetryMap.set(sessionId, normalized);
    this._isDirty = true;
    this.scheduleSave();
  }

  static recordTrafficMetrics(sessionId, peer) {
    if (!sessionId || !peer) return;
    this.ensureLoaded();

    let rec = this._telemetryMap.get(sessionId);
    if (!rec) {
      rec = this._normalizeRecord({
        stage: 1,
        stageText: 'pending',
        latestHandshake: peer.latestHandshake || 0,
        endpoint: peer.endpoint || '',
        rxBytes: peer.rxBytes || 0,
        txBytes: peer.txBytes || 0,
        bgpState: 'Pending'
      });
      this._telemetryMap.set(sessionId, rec);
    }

    const currentRx = peer.rxBytes || 0;
    const currentTx = peer.txBytes || 0;
    rec.rxBytes = currentRx;
    rec.txBytes = currentTx;
    if (peer.latestHandshake) rec.latestHandshake = peer.latestHandshake;
    if (peer.endpoint !== undefined) rec.endpoint = peer.endpoint || '';

    const nowSec = Math.floor(Date.now() / 1000);
    const WINDOW_24H_SEC = 86400;

    // Filter existing points to past 24 hours
    let series = rec.trafficSeries.filter(p => (nowSec - p[0]) <= WINDOW_24H_SEC);
    const lastPoint = series.length > 0 ? series[series.length - 1] : null;

    // Append new checkpoint if empty or if >= 1800s (30m) elapsed since the last checkpoint
    let addedNewPoint = false;
    if (!lastPoint || (nowSec - lastPoint[0]) >= 1800) {
      series.push([nowSec, currentRx, currentTx]);
      if (series.length > 48) {
        series = series.slice(-48);
      }
      addedNewPoint = true;
    }
    rec.trafficSeries = series;

    // Compute 24h rolling volume (difference between current and oldest baseline in 24h window)
    const oldestPoint = series.length > 0 ? series[0] : null;
    if (oldestPoint && currentRx >= oldestPoint[1] && currentTx >= oldestPoint[2]) {
      rec.rx24h = currentRx - oldestPoint[1];
      rec.tx24h = currentTx - oldestPoint[2];
    } else {
      rec.rx24h = currentRx;
      rec.tx24h = currentTx;
    }

    this._isDirty = true;
    if (addedNewPoint) {
      this.scheduleSave(5000); // Save promptly when a new 30m checkpoint is created
    } else {
      this.scheduleSave(60000); // Debounce routine metrics
    }
  }

  static updateBgp(sessionId, bgp) {
    if (!sessionId || !bgp) return;
    this.ensureLoaded();

    let rec = this._telemetryMap.get(sessionId);
    if (!rec) {
      rec = this._normalizeRecord({
        bgpState: bgp.bgpState || 'Pending',
        bgpInfo: bgp.info || '',
        bgpProtocolName: bgp.name || ''
      });
      this._telemetryMap.set(sessionId, rec);
    }

    rec.bgpState = bgp.bgpState || 'Pending';
    rec.bgpInfo = bgp.info || '';
    rec.bgpProtocolName = bgp.name || '';

    const normState = (bgp.bgpState || '').toLowerCase();
    if (normState === 'established') {
      rec.status = 'active';
      rec.stage = 3;
      rec.stageText = 'BGP Established';
    } else if (normState === 'connect') {
      rec.status = 'connect';
      rec.stage = 2;
      rec.stageText = 'BGP Connect';
    } else if (normState === 'active') {
      rec.status = 'connect';
      rec.stage = 2;
      rec.stageText = 'BGP Active';
    } else if (normState === 'idle') {
      rec.status = 'idle';
      rec.stage = 1;
      rec.stageText = (rec.latestHandshake > 0)
        ? 'BGP Idle (WG Handshake OK)'
        : 'BGP Idle';
    } else {
      rec.status = normState || 'pending';
      rec.stage = 2;
      rec.stageText = `BGP ${bgp.bgpState}`;
    }

    this._isDirty = true;
    this.scheduleSave(60000);
  }

  static deleteTelemetry(sessionId) {
    if (!sessionId) return;
    this.ensureLoaded();
    if (this._telemetryMap.has(sessionId)) {
      this._telemetryMap.delete(sessionId);
      this._isDirty = true;
      this.scheduleSave(1000);
    }
  }

  static renameSession(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return;
    this.ensureLoaded();
    if (this._telemetryMap.has(oldId)) {
      const data = this._telemetryMap.get(oldId);
      this._telemetryMap.delete(oldId);
      this._telemetryMap.set(newId, data);
      this._isDirty = true;
      this.scheduleSave(5000);
    }
  }

  static scheduleSave(delayMs = 30000) {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(async () => {
      this._saveTimer = null;
      try {
        await this.saveTelemetry();
      } catch (err) {
        console.warn('[SessionTelemetryManager] Background save error:', err.message);
      }
    }, delayMs);

    if (typeof this._saveTimer?.unref === 'function') {
      this._saveTimer.unref();
    }
  }

  static async saveTelemetry() {
    if (!this._isDirty) return;
    const targetPath = this.getTelemetryPath();

    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: Object.fromEntries(this._telemetryMap.entries())
    };

    // Compact single-line formatting for [t, rx, tx] arrays
    let json = JSON.stringify(payload, null, 2);
    json = json.replace(/\[\s*(\d+),\s*(\d+),\s*(\d+)\s*\]/g, (m, a, b, c) => `[${a}, ${b}, ${c}]`);

    this._isDirty = false;
    await FileStore.writeJson(targetPath, json);
  }

  static saveTelemetrySync() {
    if (!this._isDirty) return;
    const targetPath = this.getTelemetryPath();

    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sessions: Object.fromEntries(this._telemetryMap.entries())
    };

    let json = JSON.stringify(payload, null, 2);
    json = json.replace(/\[\s*(\d+),\s*(\d+),\s*(\d+)\s*\]/g, (m, a, b, c) => `[${a}, ${b}, ${c}]`);

    this._isDirty = false;
    FileStore.writeJsonSync(targetPath, json);
  }

  static async flush() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    await this.saveTelemetry();
  }

  static resetForTesting() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._telemetryMap.clear();
    this._loadedPath = null;
    this._isDirty = false;
  }
}
