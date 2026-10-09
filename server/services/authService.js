import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { ENV, getDataDir } from '../config.js';
import { getActiveConfig } from '../storage/configLoader.js';
import { FileStore } from '../storage/fileStore.js';
import { RegistryService } from './registryService.js';
import { EmailService } from './emailService.js';

// In-memory active challenges map: challengeText -> challengeData
const activeChallenges = new Map();

// In-memory password login failure tracker: lockKey -> { attempts, lockedUntil, lastAttempt }
const passwordAttemptTracker = new Map();

// Periodic cleanup of expired challenges and stale rate limits
const challengeCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, val] of activeChallenges) {
    if (now > val.expiresAt) activeChallenges.delete(key);
  }
  for (const [key, val] of passwordAttemptTracker) {
    if (now > (val.lockedUntil || (val.lastAttempt + 300 * 1000))) {
      passwordAttemptTracker.delete(key);
    }
  }
}, 60 * 1000);
if (typeof challengeCleanupTimer?.unref === 'function') {
  challengeCleanupTimer.unref();
}

// Global mutex commit queue for auth_users.json (ENG-02)
let authUsersCommitQueue = Promise.resolve();
export function withAuthUsersLock(action) {
  const result = authUsersCommitQueue.then(action, action);
  authUsersCommitQueue = result.catch(() => {});
  return result;
}

const scryptAsync = promisify(crypto.scrypt);

/**
 * Non-blocking asynchronous scrypt password hashing
 */
export async function hashPasswordAsync(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = await scryptAsync(password, salt, 64);
  return {
    salt,
    hash: key.toString('hex')
  };
}

/**
 * Non-blocking asynchronous password verification
 */
export async function verifyPasswordAsync(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  try {
    const key = await scryptAsync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (key.length !== expected.length) return false;
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * Scrypt password hashing with unique salt (synchronous fallback for fixtures & scripts)
 */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(password, salt, 64);
  return {
    salt,
    hash: key.toString('hex')
  };
}

export function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  try {
    const key = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(storedHash, 'hex');
    if (key.length !== expected.length) return false;
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

export class AuthService {
  /**
   * Authoritative admin check strictly derived from portal.config.yaml (ENG-02)
   */
  static isAdmin(asn) {
    const cleanAsn = parseInt(String(asn || '').replace(/^AS/i, ''), 10);
    if (isNaN(cleanAsn) || cleanAsn <= 0) return false;
    const config = getActiveConfig();
    return Array.isArray(config.admins) && config.admins.includes(cleanAsn);
  }

  /**
   * Simplify a mntner handle for display: AKI001-MNT -> aki001 (lowercase, no suffix)
   */
  static simplifyMnt(raw) {
    if (!raw || typeof raw !== 'string') return '';
    return raw
      .replace(/-(?:MNT|DN42)$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  static getAuthUsersPath() {
    return path.join(getDataDir(), 'auth_users.json');
  }

  static async getAuthUsers() {
    return FileStore.readJson(this.getAuthUsersPath(), {});
  }

  static async saveAuthUsers(users) {
    return FileStore.writeJson(this.getAuthUsersPath(), users);
  }

  /**
   * Authoritative lookup via RegistryService (git repo live parsing + on-demand sync)
   */
  static async getAsnRegistryInfo(asn) {
    return RegistryService.getAsnInfo(asn);
  }

  static signJwt(payload, rememberMe = false) {
    const expiresInSeconds = rememberMe ? (30 * 24 * 3600) : (24 * 3600);
    const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
    const signature = crypto.createHmac('sha256', ENV.AUTH_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return {
      token: `${header}.${body}.${signature}`,
      expiresIn: expiresInSeconds,
      expiresAt: exp * 1000
    };
  }

  static verifyJwt(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, signature] = parts;

    try {
      const expectedSig = crypto.createHmac('sha256', ENV.AUTH_JWT_SECRET).update(`${header}.${body}`).digest('base64url');
      if (expectedSig.length !== signature.length || !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signature))) {
        return null;
      }
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return null; // Expired
      }
      return payload;
    } catch {
      return null;
    }
  }

  static async createChallenge(asn) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const nonce = crypto.randomBytes(8).toString('hex');
    const challengeText = `akilab:${cleanAsn}:${nonce}`;
    const expiresInSeconds = 300; // 5 minutes

    const config = getActiveConfig();
    const namespace = config.network.shortName || 'akilab';

    // Zero-trace pipe signing commands (no temp files created on user machines)
    const sshPowershell = `'${challengeText}' | ssh-keygen -q -Y sign -n ${namespace} -f "$HOME\\.ssh\\id_ed25519"`;
    const sshLinux = `printf '%s' '${challengeText}' | ssh-keygen -q -Y sign -n ${namespace} -f "$HOME/.ssh/id_ed25519"`;

    const challengeData = {
      asn: cleanAsn,
      challengeText,
      namespace,
      expiresAt: Date.now() + (expiresInSeconds * 1000),
      expiresInSeconds,
      authTypes: ['ssh'],
      commandLinux: sshLinux,
      commandPowershell: sshPowershell,
      commands: {
        ssh_powershell: sshPowershell,
        ssh_linux: sshLinux
      },
      // Backward-compatible fields
      unixCommand: sshLinux,
      powershellCommand: sshPowershell
    };

    activeChallenges.set(challengeText, challengeData);
    return challengeData;
  }

  /**
   * Authoritative OpenSSH signature verification against allowed keys
   */
  static verifySshSignatureOffline(challengeText, signatureArmored, allowedKeys = []) {
    return new Promise((resolve) => {
      if (!signatureArmored || !signatureArmored.includes('BEGIN SSH SIGNATURE')) {
        return resolve({ success: false, error: 'Invalid SSH signature armor format' });
      }
      if (!allowedKeys || allowedKeys.length === 0) {
        return resolve({ success: false, error: 'No authorized SSH keys provided for verification' });
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-verify-'));
      const sigFile = path.join(tempDir, 'msg.txt.sig');
      const allowedKeysFile = path.join(tempDir, 'allowed_signers');

      try {
        // Clean signature lines to prevent OpenSSH sshsig_dearmor failure due to trailing spaces or blank lines
        const cleanedArmor = signatureArmored
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .join('\n') + '\n';
        fs.writeFileSync(sigFile, cleanedArmor, 'utf8');

        const config = getActiveConfig();
        const namespace = config.network.shortName || 'akilab';

        // Format allowed signers: <principal> <key-type> <key-data>
        const signersContent = allowedKeys.map(k => {
          const cleanKey = k.trim();
          return `${namespace} ${cleanKey}`;
        }).join('\n') + '\n';

        fs.writeFileSync(allowedKeysFile, signersContent, 'utf8');

        // Test raw challenge, CRLF (PowerShell string pipe), and LF (sh echo pipe)
        const candidates = [challengeText, challengeText + '\r\n', challengeText + '\n'];
        let lastError = 'Signature verification failed';
        let verifiedOutput = null;

        for (const candidate of candidates) {
          const res = spawnSync('ssh-keygen', [
            '-Y', 'verify',
            '-f', allowedKeysFile,
            '-I', namespace,
            '-n', namespace,
            '-s', sigFile
          ], { input: candidate, encoding: 'utf8', timeout: 5000 });

          if (res.status === 0) {
            verifiedOutput = res.stdout;
            break;
          } else {
            lastError = res.stderr || res.stdout || 'invalid signature';
          }
        }

        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}

        if (verifiedOutput !== null) {
          return resolve({ success: true, output: verifiedOutput });
        }
        return resolve({
          success: false,
          error: `Signature verification failed: ${lastError}`
        });
      } catch (err) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Verify SSH signature with strict DN42 registry key binding
   */
  static async verifySignature({ asn, challengeText, signature, rememberMe = false }) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const challenge = activeChallenges.get(challengeText);

    // Unconditionally delete challenge to prevent replay attacks
    activeChallenges.delete(challengeText);

    if (!challenge) {
      return { success: false, error: 'Challenge not found or expired' };
    }
    if (challenge.asn !== cleanAsn) {
      return { success: false, error: 'ASN does not match challenge' };
    }
    if (Date.now() > challenge.expiresAt) {
      return { success: false, error: 'Challenge has expired' };
    }
    if (!signature || typeof signature !== 'string' || !signature.trim()) {
      return { success: false, error: 'Signature is required' };
    }

    // 1. Authoritative lookup in DN42 Registry Git Repository
    let registryInfo;
    try {
      registryInfo = await this.getAsnRegistryInfo(cleanAsn);
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Registry sync failed, please retry later'
      };
    }

    if (!registryInfo || !Array.isArray(registryInfo.authKeys) || registryInfo.authKeys.length === 0) {
      return {
        success: false,
        error: `No SSH public keys registered in DN42 registry for AS${cleanAsn}`
      };
    }

    // 2. Authoritative OpenSSH Verification
    const verifyRes = await this.verifySshSignatureOffline(challengeText, signature, registryInfo.authKeys);
    if (!verifyRes.success) {
      return {
        success: false,
        error: verifyRes.error || 'SSH signature verification failed against registry keys'
      };
    }

    // 3. Issue Token
    const isAdmin = this.isAdmin(cleanAsn);

    const maintainer = registryInfo?.maintainer || '';
    const mnt = this.simplifyMnt(maintainer) || this.simplifyMnt(registryInfo?.asName) || `as${cleanAsn}`;

    const tokenData = this.signJwt({
      asn: cleanAsn,
      asName: registryInfo.asName || `AS${cleanAsn}`,
      mnt,
      role: isAdmin ? 'admin' : 'user'
    }, rememberMe);

    return {
      success: true,
      data: {
        asn: cleanAsn,
        asName: registryInfo.asName || `AS${cleanAsn}`,
        maintainer,
        mnt,
        role: isAdmin ? 'admin' : 'user',
        ...tokenData
      }
    };
  }

  /**
   * Reset in-memory failed login attempts for an ASN/username (helper for tests and admin)
   */
  static resetPasswordAttempts(key) {
    if (key) {
      const cleanKey = String(key).replace(/^AS/i, '').toLowerCase();
      passwordAttemptTracker.delete(cleanKey);
      passwordAttemptTracker.delete(String(key).toLowerCase());
    } else {
      passwordAttemptTracker.clear();
    }
  }

  /**
   * Password login loaded from server/data/auth_users.json with scrypt verification
   */
  static async loginWithPassword({ username, asn, password, rememberMe = false }) {
    const rawUser = String(username || asn || '').trim();
    if (!rawUser || !password) {
      return { success: false, error: 'Username/ASN and password are required' };
    }

    const cleanAsn = parseInt(rawUser.replace(/^AS/i, ''), 10);
    const lockKey = String(cleanAsn || rawUser).toLowerCase();
    const now = Date.now();
    const attemptRecord = passwordAttemptTracker.get(lockKey);

    if (attemptRecord && attemptRecord.lockedUntil > now) {
      const remainingSec = Math.ceil((attemptRecord.lockedUntil - now) / 1000);
      return {
        success: false,
        error: `Account temporarily locked due to multiple failed login attempts. Please wait ${remainingSec}s.`
      };
    }

    const authUsers = await this.getAuthUsers();

    const recordFailure = () => {
      const current = passwordAttemptTracker.get(lockKey);
      const currentTime = Date.now();
      const isLockExpired = current && current.lockedUntil > 0 && current.lockedUntil <= currentTime;
      const isStale = current && (currentTime - (current.lastAttempt || 0)) > 300 * 1000;
      const count = (isLockExpired || isStale || !current ? 0 : (current.attempts || 0)) + 1;

      if (count >= 5) {
        passwordAttemptTracker.set(lockKey, {
          attempts: count,
          lockedUntil: currentTime + 60 * 1000,
          lastAttempt: currentTime
        });
        return {
          success: false,
          error: 'Account temporarily locked due to multiple failed login attempts. Please wait 60s.'
        };
      } else {
        passwordAttemptTracker.set(lockKey, {
          attempts: count,
          lockedUntil: 0,
          lastAttempt: currentTime
        });
        return { success: false, error: 'Invalid username or password' };
      }
    };

    // Match by key: username or AS<asn> or numeric asn
    let userEntry = authUsers[rawUser] || (cleanAsn ? authUsers[String(cleanAsn)] : null) || (cleanAsn ? authUsers[`AS${cleanAsn}`] : null);

    if (!userEntry) {
      return recordFailure();
    }

    const isMatch = await verifyPasswordAsync(password, userEntry.salt, userEntry.hash);
    if (!isMatch) {
      return recordFailure();
    }

    // Succeeded: clear attempt history
    passwordAttemptTracker.delete(lockKey);

    const userAsn = userEntry.asn || cleanAsn;
    const isAdmin = this.isAdmin(userAsn);

    let maintainer = '';
    try {
      const regInfo = await this.getAsnRegistryInfo(userAsn);
      maintainer = regInfo?.maintainer || '';
    } catch {
      // Registry offline/uninitialized: fall back to asName-derived tag
    }
    const mnt = this.simplifyMnt(maintainer) || this.simplifyMnt(userEntry.asName) || `as${userAsn}`;

    const tokenData = this.signJwt({
      asn: userAsn,
      asName: userEntry.asName || `AS${userAsn}`,
      mnt,
      role: isAdmin ? 'admin' : 'user'
    }, rememberMe);

    return {
      success: true,
      data: {
        asn: userAsn,
        asName: userEntry.asName || `AS${userAsn}`,
        maintainer,
        mnt,
        role: isAdmin ? 'admin' : 'user',
        ...tokenData
      }
    };
  }

  /**
   * Set or update password for authenticated user in auth_users.json
   */
  static async setPassword(asn, newPassword) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    if (!cleanAsn || isNaN(cleanAsn)) {
      return { success: false, error: 'Invalid ASN' };
    }
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters long' };
    }

    const { salt, hash } = await hashPasswordAsync(newPassword);

    return withAuthUsersLock(async () => {
      const authUsers = await this.getAuthUsers();
      const isAdmin = this.isAdmin(cleanAsn);

      const now = new Date().toISOString();
      authUsers[String(cleanAsn)] = {
        asn: cleanAsn,
        asName: `AS${cleanAsn}`,
        role: isAdmin ? 'admin' : 'user',
        salt,
        hash,
        createdAt: authUsers[String(cleanAsn)]?.createdAt || now,
        updatedAt: now
      };

      await this.saveAuthUsers(authUsers);
      return { success: true, message: 'Password updated successfully' };
    });
  }

  /**
   * Check if a password is set for the given ASN in auth_users.json
   */
  static async hasPassword(asn) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const authUsers = await this.getAuthUsers();
    return !!(authUsers[String(cleanAsn)] || authUsers[`AS${cleanAsn}`] || authUsers[String(asn)]);
  }

  /**
   * Verify email OTP code and issue JWT token
   */
  static async verifyEmailOtp({ asn, code, rememberMe = false }) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    if (!cleanAsn || isNaN(cleanAsn)) {
      return { success: false, error: 'Valid ASN is required' };
    }
    if (!code || typeof code !== 'string') {
      return { success: false, error: 'Verification code is required' };
    }

    const otpRes = EmailService.verifyOtp(cleanAsn, code);
    if (!otpRes.valid) {
      return { success: false, error: otpRes.error };
    }

    let registryInfo = null;
    try {
      registryInfo = await this.getAsnRegistryInfo(cleanAsn);
    } catch {}

    const isAdmin = this.isAdmin(cleanAsn);
    const maintainer = registryInfo?.maintainer || '';
    const mnt = this.simplifyMnt(maintainer) || this.simplifyMnt(registryInfo?.asName) || `as${cleanAsn}`;

    const tokenData = this.signJwt({
      asn: cleanAsn,
      asName: registryInfo?.asName || `AS${cleanAsn}`,
      mnt,
      role: isAdmin ? 'admin' : 'user'
    }, rememberMe);

    const hasPassword = await this.hasPassword(cleanAsn);

    return {
      success: true,
      data: {
        asn: cleanAsn,
        asName: registryInfo?.asName || `AS${cleanAsn}`,
        maintainer,
        mnt,
        role: isAdmin ? 'admin' : 'user',
        hasPassword,
        ...tokenData
      }
    };
  }
}
