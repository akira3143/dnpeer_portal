import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getDataDir } from '../config.js';

let periodicTimer = null;
let inFlightSyncPromise = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse RPSL lines into array of { key, value } entries.
 * Case-insensitive keys; handles multi-line continuation.
 */
export function parseRpslLines(content) {
  if (!content || typeof content !== 'string') return [];
  const lines = content.split(/\r?\n/);
  const records = [];
  let currentKey = null;
  let currentValue = '';

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#') || line.startsWith('%')) {
      continue;
    }
    // Check continuation line (starts with whitespace)
    if (/^[ \t]+/.test(line) && currentKey) {
      currentValue += '\n' + line.trim();
      continue;
    }
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (match) {
      if (currentKey) {
        records.push({ key: currentKey.toLowerCase(), value: currentValue });
      }
      currentKey = match[1];
      currentValue = match[2].trim();
    }
  }
  if (currentKey) {
    records.push({ key: currentKey.toLowerCase(), value: currentValue });
  }
  return records;
}

export class RegistryService {
  static getRegistryDir() {
    return path.join(getDataDir(), 'registry');
  }

  static isRepoInitialized(repoDir = this.getRegistryDir()) {
    return fs.existsSync(path.join(repoDir, '.git'));
  }

  /**
   * Parse data/aut-num/AS<cleanAsn>
   */
  static parseAsnObject(cleanAsn, repoDir = this.getRegistryDir()) {
    const autNumFile = path.join(repoDir, 'data', 'aut-num', `AS${cleanAsn}`);
    if (!fs.existsSync(autNumFile)) {
      return null;
    }

    try {
      const content = fs.readFileSync(autNumFile, 'utf8');
      const records = parseRpslLines(content);

      let asName = `AS${cleanAsn}`;
      let descr = '';
      let adminContact = '';
      let techContact = '';
      const mntByList = [];

      for (const rec of records) {
        switch (rec.key) {
          case 'as-name':
            asName = rec.value;
            break;
          case 'descr':
            descr = descr ? `${descr} ${rec.value}` : rec.value;
            break;
          case 'admin-c':
            adminContact = rec.value;
            break;
          case 'tech-c':
            techContact = rec.value;
            break;
          case 'mnt-by':
            if (rec.value && !mntByList.includes(rec.value)) {
              mntByList.push(rec.value);
            }
            break;
        }
      }

      return {
        asn: cleanAsn,
        asName,
        descr: descr || 'DN42 Autonomous System',
        adminContact,
        techContact,
        maintainer: mntByList[0] || '',
        maintainers: mntByList
      };
    } catch (err) {
      console.error(`[RegistryService] Error reading aut-num for AS${cleanAsn}:`, err.message);
      return null;
    }
  }

  /**
   * Extract SSH public keys from data/auth/<MNT> and data/mntner/<MNT>
   */
  static parseAuthKeys(maintainerHandle, repoDir = this.getRegistryDir()) {
    if (!maintainerHandle || typeof maintainerHandle !== 'string') {
      return [];
    }

    const candidatePaths = [
      path.join(repoDir, 'data', 'auth', maintainerHandle),
      path.join(repoDir, 'data', 'mntner', maintainerHandle),
      path.join(repoDir, 'data', 'person', maintainerHandle),
      path.join(repoDir, 'data', 'role', maintainerHandle)
    ];

    const authKeys = [];

    for (const filePath of candidatePaths) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const records = parseRpslLines(content);
          for (const rec of records) {
            if (rec.key === 'auth') {
              // Value might be "ssh-ed25519 AAA..." or multi-line / folded continuation
              const fullClean = rec.value.replace(/\r?\n\s*/g, ' ').trim();
              const candidateLines = [fullClean, ...rec.value.split(/\r?\n/)];
              for (const part of candidateLines) {
                const trimmed = part.trim().replace(/^auth:\s*/i, '');
                if (/^(ssh-[a-z0-9-]+|ecdsa-[a-z0-9-]+|sk-ssh-[a-z0-9-]+(?:@openssh\.com)?|sk-ecdsa-[a-z0-9-]+(?:@openssh\.com)?)\s+[A-Za-z0-9+/=]+/i.test(trimmed)) {
                  if (!authKeys.includes(trimmed)) {
                    authKeys.push(trimmed);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`[RegistryService] Error reading auth file ${filePath}:`, err.message);
        }
      }
    }

    return authKeys;
  }

  /**
   * Parse contact text directly for email addresses and person name
   */
  static parseContactInfoFromText(content, handle = '') {
    if (!content || typeof content !== 'string') return { emails: [], personName: '', primaryEmail: '', emailSource: handle };
    const records = parseRpslLines(content);
    const emails = [];
    let personName = '';
    for (const rec of records) {
      if (!personName && (rec.key === 'person' || rec.key === 'role' || rec.key === 'descr')) {
        personName = rec.value;
      }
      if (rec.key === 'e-mail' || rec.key === 'email' || rec.key === 'contact') {
        const matches = rec.value.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
        if (matches) {
          for (const em of matches) {
            const cleanEm = em.toLowerCase().trim();
            if (!emails.includes(cleanEm)) {
              emails.push(cleanEm);
            }
          }
        }
      }
    }
    return {
      emails,
      personName,
      primaryEmail: emails[0] || '',
      emailSource: handle
    };
  }

  /**
   * Extract email addresses and person name from data/person/<HANDLE>, data/role/<HANDLE>, data/mntner/<HANDLE>
   */
  static parseContactInfo(handle, repoDir = this.getRegistryDir()) {
    if (!handle || typeof handle !== 'string') return { emails: [], personName: '', primaryEmail: '', emailSource: '' };

    const candidatePaths = [
      path.join(repoDir, 'data', 'person', handle),
      path.join(repoDir, 'data', 'role', handle),
      path.join(repoDir, 'data', 'mntner', handle)
    ];

    const emails = [];
    let personName = '';

    for (const filePath of candidatePaths) {
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const parsed = this.parseContactInfoFromText(content, handle);
          if (!personName && parsed.personName) {
            personName = parsed.personName;
          }
          for (const em of parsed.emails) {
            if (!emails.includes(em)) {
              emails.push(em);
            }
          }
        } catch (err) {
          console.error(`[RegistryService] Error reading contact file ${filePath}:`, err.message);
        }
      }
    }
    return { emails, personName, primaryEmail: emails[0] || '', emailSource: handle };
  }

  /**
   * Read complete ASN info, emails, and SSH public keys from local files
   */
  static readLocalAsn(cleanAsn, repoDir = this.getRegistryDir()) {
    const asnObj = this.parseAsnObject(cleanAsn, repoDir);
    if (!asnObj) return null;

    const allKeys = [];
    const allEmails = [];
    let discoveredPersonName = '';

    const candidateHandles = asnObj.maintainers && asnObj.maintainers.length > 0
      ? [...asnObj.maintainers]
      : (asnObj.maintainer ? [asnObj.maintainer] : []);

    if (asnObj.adminContact && !candidateHandles.includes(asnObj.adminContact)) {
      candidateHandles.push(asnObj.adminContact);
    }
    if (asnObj.techContact && !candidateHandles.includes(asnObj.techContact)) {
      candidateHandles.push(asnObj.techContact);
    }

    for (const hdl of candidateHandles) {
      const keys = this.parseAuthKeys(hdl, repoDir);
      for (const k of keys) {
        if (!allKeys.includes(k)) allKeys.push(k);
      }

      const { emails, personName } = this.parseContactInfo(hdl, repoDir);
      if (!discoveredPersonName && personName) {
        discoveredPersonName = personName;
      }
      for (const em of emails) {
        if (!allEmails.some(e => e.email === em)) {
          allEmails.push({ email: em, source: hdl });
        }
      }
    }

    // Prioritize first ssh-ed25519 key, then fallback to first of other types
    const edKey = allKeys.find(k => k.startsWith('ssh-ed25519 '));
    const primarySshKey = edKey || allKeys[0] || '';

    const primaryEmail = allEmails[0]?.email || '';
    const emailSource = allEmails[0]?.source || '';

    return {
      asn: cleanAsn,
      asName: asnObj.asName,
      descr: asnObj.descr,
      adminContact: asnObj.adminContact,
      techContact: asnObj.techContact,
      maintainer: asnObj.maintainer,
      maintainers: asnObj.maintainers,
      personName: discoveredPersonName || asnObj.adminContact || '',
      authKeys: allKeys,
      primarySshKey,
      emails: allEmails,
      primaryEmail,
      emailSource
    };
  }

  /**
   * Asynchronously run git -C <repoDir> pull
   */
  static async runGitPull(repoDir) {
    return new Promise((resolve) => {
      const child = spawn('git', ['-C', repoDir, 'pull'], {
        stdio: ['ignore', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 15000);

      child.stdout?.on('data', (d) => { stdout += d; });
      child.stderr?.on('data', (d) => { stderr += d; });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ success: false, error: err.message, code: -1 });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ success: false, error: 'git pull timed out after 15s', code: 124 });
        } else {
          resolve({ success: code === 0, code, stdout, stderr });
        }
      });
    });
  }

  /**
   * Sync registry with retry:
   * 1st pull -> on failure wait 2s -> 2nd pull -> on failure throw "Registry sync failed, please retry later"
   */
  static async syncRegistry(repoDir = this.getRegistryDir()) {
    if (!this.isRepoInitialized(repoDir)) {
      throw new Error(`DN42 registry repository not found. Please clone it first: git clone --depth 1 https://git.dn42.dev/dn42/registry ${repoDir}`);
    }

    if (inFlightSyncPromise) {
      return inFlightSyncPromise;
    }

    inFlightSyncPromise = (async () => {
      try {
        // Attempt 1
        const res1 = await this.runGitPull(repoDir);
        if (res1.success) {
          return true;
        }

        console.warn(`[RegistryService] git pull attempt 1 failed (code ${res1.code}). Sleeping 2s before retry...`);
        await sleep(2000);

        // Attempt 2 (retry on lock/concurrency collision)
        const res2 = await this.runGitPull(repoDir);
        if (res2.success) {
          return true;
        }

        console.error(`[RegistryService] git pull attempt 2 failed (code ${res2.code}): ${res2.stderr || res2.error}`);
        throw new Error('Registry sync failed, please retry later');
      } finally {
        inFlightSyncPromise = null;
      }
    })();

    return inFlightSyncPromise;
  }

  /**
   * Authoritative lookup:
   * 1. Check local repository files
   * 2. If missing or no auth keys, trigger on-demand syncRegistry()
   * 3. Re-read local files
   */
  static async getAsnInfo(asn, repoDir = this.getRegistryDir()) {
    const cleanAsn = parseInt(String(asn).replace(/^AS/i, ''), 10);
    if (isNaN(cleanAsn) || cleanAsn <= 0) {
      return null;
    }

    if (!this.isRepoInitialized(repoDir)) {
      throw new Error(`DN42 registry repository not found. Please clone it first: git clone --depth 1 https://git.dn42.dev/dn42/registry ${repoDir}`);
    }

    // Step 1: Check local files (hit check)
    let info = this.readLocalAsn(cleanAsn, repoDir);
    if (info) {
      return info;
    }

    // Step 2: File missing (cache miss) -> trigger on-demand sync
    await this.syncRegistry(repoDir);

    // Step 3: Re-read after sync
    info = this.readLocalAsn(cleanAsn, repoDir);
    return info; // returns object or null if ASN doesn't exist
  }

  /**
   * In-process background timer: pull every 10 minutes to warm repository
   */
  static startPeriodicSync(intervalMs = (parseInt(process.env.REGISTRY_SYNC_INTERVAL_MS, 10) || 10 * 60 * 1000)) {
    if (periodicTimer) return periodicTimer;

    periodicTimer = setInterval(async () => {
      try {
        if (this.isRepoInitialized()) {
          await this.syncRegistry();
        }
      } catch (err) {
        console.error('[RegistryService] Periodic background sync failed:', err.message);
      }
    }, intervalMs);

    if (typeof periodicTimer?.unref === 'function') {
      periodicTimer.unref();
    }

    return periodicTimer;
  }

  static stopPeriodicSync() {
    if (periodicTimer) {
      clearInterval(periodicTimer);
      periodicTimer = null;
    }
  }
}
