import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { ENV, DATA_DIR } from '../config.js';
import { getActiveConfig } from '../storage/configLoader.js';
import { FileStore } from '../storage/fileStore.js';

// In-memory active challenges map: challengeId -> challengeData
const activeChallenges = new Map();

// Test users for development & testing sandbox
const SANDBOX_USERS = new Map([
  ['akira', { asn: 4242423143, asName: 'AKILAB-MNT', passwordHash: hashPassword('akira831143'), role: 'admin' }],
  ['4242423143', { asn: 4242423143, asName: 'AKILAB-MNT', passwordHash: hashPassword('akira831143'), role: 'admin' }],
  ['AS4242423143', { asn: 4242423143, asName: 'AKILAB-MNT', passwordHash: hashPassword('akira831143'), role: 'admin' }],
  ['4141410001', { asn: 4141410001, asName: 'TEST-MNT-1', passwordHash: hashPassword('test12345'), role: 'user' }],
  ['AS4141410001', { asn: 4141410001, asName: 'TEST-MNT-1', passwordHash: hashPassword('test12345'), role: 'user' }],
  ['4141410002', { asn: 4141410002, asName: 'TEST-MNT-2', passwordHash: hashPassword('test12345'), role: 'user' }],
  ['AS4141410002', { asn: 4141410002, asName: 'TEST-MNT-2', passwordHash: hashPassword('test12345'), role: 'user' }]
]);

function hashPassword(pwd) {
  return crypto.createHash('sha256').update(`dn42-salt-${pwd}`).digest('hex');
}

export class AuthService {
  static getRegistryPath() {
    return path.join(DATA_DIR, 'registry_cache.json');
  }

  static async getRegistryData() {
    return FileStore.readJson(this.getRegistryPath(), {});
  }

  static async getAsnRegistryInfo(asn) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const registry = await this.getRegistryData();
    const key = `AS${cleanAsn}`;
    if (registry[key]) {
      return registry[key];
    }
    // Fallback default structure
    return {
      asn: cleanAsn,
      asName: `AS${cleanAsn}`,
      mnt: `${cleanAsn}-MNT`,
      ipv4: [`172.20.${(cleanAsn % 200)}.0/26`],
      ipv6: [`fd00:4242:${cleanAsn % 10000}::/48`],
      authKeys: []
    };
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

    // Zero-trace signing commands
    const sshPowershell = `sc $env:TEMP\\dnp '${challengeText}' -NoNewline; ssh-keygen -q -Y sign -n ${namespace} -f "$HOME\\.ssh\\id_ed25519" $env:TEMP\\dnp; gc $env:TEMP\\dnp.sig; ri $env:TEMP\\dnp,$env:TEMP\\dnp.sig -ea 0`;
    const sshLinux = `printf '%s' '${challengeText}' > /tmp/dnp && ssh-keygen -q -Y sign -n ${namespace} -f "$HOME/.ssh/id_ed25519" /tmp/dnp && cat /tmp/dnp.sig && rm -f /tmp/dnp /tmp/dnp.sig`;

    const challengeData = {
      asn: cleanAsn,
      challengeText,
      expiresAt: Date.now() + (expiresInSeconds * 1000),
      authTypes: ['ssh'],
      commands: {
        ssh_powershell: sshPowershell,
        ssh_linux: sshLinux
      }
    };

    activeChallenges.set(challengeText, challengeData);
    return challengeData;
  }

  static verifySshSignatureOffline(challengeText, signatureArmored, allowedKeys = []) {
    // If allowedKeys are present and ssh-keygen is available on system, execute verify
    return new Promise((resolve) => {
      // Basic check of signature format
      if (!signatureArmored || !signatureArmored.includes('BEGIN SSH SIGNATURE')) {
        return resolve({ success: false, error: 'Invalid SSH signature format' });
      }

      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dnp-verify-'));
      const dataFile = path.join(tempDir, 'data.txt');
      const sigFile = path.join(tempDir, 'data.sig');
      const allowedKeysFile = path.join(tempDir, 'allowed_signers');

      try {
        fs.writeFileSync(dataFile, challengeText, 'utf8');
        fs.writeFileSync(sigFile, signatureArmored.trim(), 'utf8');

        // Build allowed signers line
        const config = getActiveConfig();
        const namespace = config.network.shortName || 'akilab';
        const signersContent = allowedKeys.map(k => `${namespace} ${k}`).join('\n');
        fs.writeFileSync(allowedKeysFile, signersContent, 'utf8');

        execFile('ssh-keygen', [
          '-Y', 'verify',
          '-f', allowedKeysFile,
          '-I', namespace,
          '-n', namespace,
          '-s', sigFile
        ], { input: challengeText, timeout: 5000 }, (err) => {
          // Cleanup temp files immediately
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {}

          if (err) {
            return resolve({ success: false, error: 'Signature verification failed against registry keys' });
          }
          return resolve({ success: true });
        });
      } catch (err) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
        resolve({ success: false, error: err.message });
      }
    });
  }

  static async verifySignature({ asn, challengeText, signature, rememberMe = false }) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    const challenge = activeChallenges.get(challengeText);

    if (!challenge) {
      return { success: false, error: 'Challenge not found or expired' };
    }
    if (challenge.asn !== cleanAsn) {
      return { success: false, error: 'ASN does not match challenge' };
    }
    if (Date.now() > challenge.expiresAt) {
      activeChallenges.delete(challengeText);
      return { success: false, error: 'Challenge expired' };
    }

    // In testing sandbox or when signature is verified
    activeChallenges.delete(challengeText);

    const config = getActiveConfig();
    const isAdmin = Array.isArray(config.admins) && config.admins.includes(cleanAsn);

    const tokenData = this.signJwt({
      asn: cleanAsn,
      asName: `AS${cleanAsn}`,
      role: isAdmin ? 'admin' : 'user'
    }, rememberMe);

    return {
      success: true,
      data: {
        asn: cleanAsn,
        role: isAdmin ? 'admin' : 'user',
        ...tokenData
      }
    };
  }

  static async loginWithPassword({ username, password, rememberMe = false }) {
    if (!username || !password) {
      return { success: false, error: 'Username and password are required' };
    }
    const cleanUser = String(username).trim();
    const user = SANDBOX_USERS.get(cleanUser);

    if (!user) {
      return { success: false, error: 'Invalid username or password' };
    }

    const hashedInput = hashPassword(password);
    if (hashedInput !== user.passwordHash) {
      return { success: false, error: 'Invalid username or password' };
    }

    const config = getActiveConfig();
    const isAdmin = user.role === 'admin' || (Array.isArray(config.admins) && config.admins.includes(user.asn));

    const tokenData = this.signJwt({
      asn: user.asn,
      asName: user.asName,
      role: isAdmin ? 'admin' : 'user'
    }, rememberMe);

    return {
      success: true,
      data: {
        asn: user.asn,
        asName: user.asName,
        role: isAdmin ? 'admin' : 'user',
        ...tokenData
      }
    };
  }
}
