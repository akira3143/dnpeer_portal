/**
 * NodeTokenStorage (server/storage/nodeTokenStorage.js)
 *
 * Dedicated storage engine for per-node probe authentication tokens.
 * Persists to ${PORTAL_DATA_DIR}/node_tokens.json (gitignored).
 *
 * Each edge node receives a unique 256-bit cryptographically secure hex token.
 * Generated idempotently on demand.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDataDir } from '../config.js';
import { FileStore } from './fileStore.js';

class NodeTokenStorageService {
  getFilePath() {
    return path.join(getDataDir(), 'node_tokens.json');
  }

  /**
   * Read all tokens from disk synchronously
   * @returns {Record<string, string>}
   */
  getAllTokens() {
    const filePath = this.getFilePath();
    return FileStore.readJsonSync(filePath, {}) || {};
  }

  /**
   * Get token for a specific node
   * @param {string} nodeId
   * @returns {string | null}
   */
  getToken(nodeId) {
    if (!nodeId || typeof nodeId !== 'string') return null;
    const tokens = this.getAllTokens();
    const cleanId = nodeId.trim();
    if (tokens[cleanId]) return tokens[cleanId];
    // Case-insensitive lookup fallback
    const lowerId = cleanId.toLowerCase();
    for (const [key, val] of Object.entries(tokens)) {
      if (key.toLowerCase() === lowerId) return val;
    }
    return null;
  }

  /**
   * Atomically save tokens object to disk
   * @param {Record<string, string>} tokens
   */
  saveTokens(tokens) {
    const filePath = this.getFilePath();
    const dir = path.dirname(filePath);
    FileStore.ensureDirectory(dir);

    const content = JSON.stringify(tokens, null, 2) + '\n';
    const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

    try {
      fs.writeFileSync(tempPath, content, 'utf8');
      try {
        fs.renameSync(tempPath, filePath);
      } catch (renameErr) {
        fs.copyFileSync(tempPath, filePath);
        try { fs.unlinkSync(tempPath); } catch {}
      }
    } catch (err) {
      console.error(`[NodeTokenStorage] Failed to persist node tokens:`, err.message);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
      throw err;
    }
  }

  /**
   * Get existing token or generate a new 256-bit hex token idempotently
   * @param {string} nodeId
   * @returns {string}
   */
  getOrCreateToken(nodeId) {
    if (!nodeId || typeof nodeId !== 'string') {
      throw new Error('Valid nodeId is required to get or create token');
    }
    const cleanId = nodeId.trim();
    const existing = this.getToken(cleanId);
    if (existing) {
      return existing;
    }

    const newToken = crypto.randomBytes(32).toString('hex');
    const tokens = this.getAllTokens();
    tokens[cleanId] = newToken;
    this.saveTokens(tokens);
    return newToken;
  }

  /**
   * Explicitly set or overwrite a token for a node
   * @param {string} nodeId
   * @param {string} token
   */
  setToken(nodeId, token) {
    if (!nodeId || !token) return;
    const cleanId = nodeId.trim();
    const tokens = this.getAllTokens();
    tokens[cleanId] = token.trim();
    this.saveTokens(tokens);
  }

  /**
   * Verify if a given token matches the configured token for a node
   * @param {string} nodeId
   * @param {string} token
   * @returns {boolean}
   */
  verifyToken(nodeId, token) {
    if (!nodeId || !token || typeof nodeId !== 'string' || typeof token !== 'string') {
      return false;
    }
    const cleanToken = token.trim();
    if (!cleanToken) return false;

    const expectedToken = this.getToken(nodeId);
    if (!expectedToken) return false;

    const expectedBuf = Buffer.from(expectedToken);
    const candidateBuf = Buffer.from(cleanToken);

    if (expectedBuf.length !== candidateBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, candidateBuf);
  }

  /**
   * Clear all tokens (used in test teardown)
   */
  clearTokens() {
    const filePath = this.getFilePath();
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }
}

export const NodeTokenStorage = new NodeTokenStorageService();

