import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Mutex queues per file path to prevent concurrent write collisions
const fileQueues = new Map();

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
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  static readJsonSync(filePath, defaultValue = null) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(stripJsonComments(raw));
      }
    } catch (err) {
      console.error(`[FileStore] Error reading JSON ${filePath}:`, err.message);
    }
    return defaultValue;
  }

  static async readJson(filePath, defaultValue = null) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = await fs.promises.readFile(filePath, 'utf8');
        return JSON.parse(stripJsonComments(raw));
      }
    } catch (err) {
      console.error(`[FileStore] Error async reading JSON ${filePath}:`, err.message);
    }
    return defaultValue;
  }

  static async writeJson(filePath, data, header = '') {
    const queueKey = path.resolve(filePath);
    const prevQueue = fileQueues.get(queueKey) || Promise.resolve();

    const writeOp = async () => {
      const dir = path.dirname(filePath);
      this.ensureDirectory(dir);

      const content = (header ? header : '') + (typeof data === 'string' ? data : JSON.stringify(data, null, 2));
      const tempPath = `${filePath}.${crypto.randomBytes(6).toString('hex')}.tmp`;

      await fs.promises.writeFile(tempPath, content, 'utf8');

      // Atomic rename (Windows safe fallback if file is temporarily locked)
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
    fs.writeFileSync(tempPath, content, 'utf8');
    try {
      fs.renameSync(tempPath, filePath);
    } catch {
      fs.copyFileSync(tempPath, filePath);
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }
}
