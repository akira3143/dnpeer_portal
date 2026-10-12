import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Mutex queues per file path to prevent concurrent write collisions
const fileQueues = new Map();

export class DataCorruptionError extends Error {
  constructor(filePath, cause) {
    super(`[DataCorruptionError] File '${filePath}' exists but contains invalid or corrupted data: ${cause?.message || cause}. A backup may be available at '${filePath}.bak'.`);
    this.name = 'DataCorruptionError';
    this.filePath = filePath;
    this.cause = cause;
  }
}

function stripJsonComments(str) {
  if (!str) return '{}';
  // 1. Strip comments while preserving string literals (ENG-06)
  const withoutComments = str.replace(/("(?:\\.|[^"\\])*")|(\/\/[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\/)/g, (match, strLiteral) => {
    return strLiteral || '';
  });
  // 2. Strip trailing commas before } or ] while preserving string literals
  return withoutComments.replace(/("(?:\\.|[^"\\])*")|(,\s*([\]}]))/g, (match, strLiteral, _commaGroup, closeBracket) => {
    if (strLiteral) return strLiteral;
    return closeBracket;
  });
}

export class FileStore {
  static ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    }
    if (process.platform !== 'win32') {
      try {
        fs.chmodSync(dirPath, 0o700);
      } catch {}
    }
  }

  static readJsonSync(filePath, defaultValue = null, options = { failClosed: true }) {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const failClosed = typeof options === 'boolean' ? options : (options?.failClosed !== false);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw || !raw.trim()) {
        throw new Error('File content is empty or blank');
      }
      return JSON.parse(stripJsonComments(raw));
    } catch (err) {
      if (failClosed) {
        throw new DataCorruptionError(filePath, err);
      }
      console.error(`[FileStore] Error reading JSON ${filePath}:`, err.message);
      return defaultValue;
    }
  }

  static async readJson(filePath, defaultValue = null, options = { failClosed: true }) {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const failClosed = typeof options === 'boolean' ? options : (options?.failClosed !== false);
    try {
      const raw = await fs.promises.readFile(filePath, 'utf8');
      if (!raw || !raw.trim()) {
        throw new Error('File content is empty or blank');
      }
      return JSON.parse(stripJsonComments(raw));
    } catch (err) {
      if (failClosed) {
        throw new DataCorruptionError(filePath, err);
      }
      console.error(`[FileStore] Error async reading JSON ${filePath}:`, err.message);
      return defaultValue;
    }
  }

  static async writeJson(filePath, data, header = '') {
    const queueKey = path.resolve(filePath);
    const prevQueue = fileQueues.get(queueKey) || Promise.resolve();

    const writeOp = async () => {
      const dir = path.dirname(filePath);
      this.ensureDirectory(dir);

      const content = (header ? header : '') + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

      // 1. Write temp file with mode 0o600
      await fs.promises.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600 });

      // 2. Single-generation backup of existing authoritative file before replacing
      if (fs.existsSync(filePath)) {
        try {
          const bakPath = `${filePath}.bak`;
          await fs.promises.copyFile(filePath, bakPath);
          if (process.platform !== 'win32') {
            await fs.promises.chmod(bakPath, 0o600).catch(() => {});
          }
        } catch (bakErr) {
          console.warn(`[FileStore] Warning: Could not create backup for ${filePath}:`, bakErr.message);
        }
      }

      // 3. Atomic rename (Windows safe fallback if file is temporarily locked)
      try {
        await fs.promises.rename(tempPath, filePath);
      } catch (err) {
        // Fallback for Windows EPERM / EXDEV
        try {
          await fs.promises.copyFile(tempPath, filePath);
          await fs.promises.unlink(tempPath);
        } catch (copyErr) {
          try { await fs.promises.unlink(tempPath); } catch {}
          throw copyErr;
        }
      }

      // 4. Ensure destination file maintains 0o600 permissions
      if (process.platform !== 'win32') {
        try {
          await fs.promises.chmod(filePath, 0o600);
        } catch {}
      }
    };

    const currentQueue = prevQueue.then(writeOp, writeOp);
    fileQueues.set(queueKey, currentQueue);
    return currentQueue;
  }

  static writeJsonSync(filePath, data, header = '') {
    const dir = path.dirname(filePath);
    this.ensureDirectory(dir);

    const content = (header ? header : '') + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

    // 1. Write temp file with mode 0o600
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });

    // 2. Single-generation backup of existing authoritative file before replacing
    if (fs.existsSync(filePath)) {
      try {
        const bakPath = `${filePath}.bak`;
        fs.copyFileSync(filePath, bakPath);
        if (process.platform !== 'win32') {
          try { fs.chmodSync(bakPath, 0o600); } catch {}
        }
      } catch (bakErr) {
        console.warn(`[FileStore] Warning: Could not create backup for ${filePath}:`, bakErr.message);
      }
    }

    // 3. Replace target
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      fs.copyFileSync(tempPath, filePath);
      try { fs.unlinkSync(tempPath); } catch {}
    }

    // 4. Enforce 0o600 mode on target
    if (process.platform !== 'win32') {
      try { fs.chmodSync(filePath, 0o600); } catch {}
    }
  }

  /**
   * Self-check and enforce 0600 on sensitive data directory files and 0700 on directory
   * @param {string} dataDir
   */
  static secureSensitiveFiles(dataDir) {
    if (process.platform === 'win32' || !dataDir) return;
    try {
      if (fs.existsSync(dataDir)) {
        fs.chmodSync(dataDir, 0o700);
      }
      const sensitiveFiles = [
        'auth_users.json',
        'auth_users.json.bak',
        'node_tokens.json',
        'node_tokens.json.bak',
        'peering_sessions.json',
        'peering_sessions.json.bak',
        'port_ledger.json',
        'port_ledger.json.bak',
        'session_telemetry.json',
        'session_telemetry.json.bak'
      ];
      for (const file of sensitiveFiles) {
        const p = path.join(dataDir, file);
        if (fs.existsSync(p)) {
          try { fs.chmodSync(p, 0o600); } catch {}
        }
      }
    } catch (err) {
      console.warn('[FileStore] Notice: secureSensitiveFiles encountered error:', err.message);
    }
  }
}
