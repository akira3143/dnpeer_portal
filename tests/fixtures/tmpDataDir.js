/**
 * Isolated Temporary Data Directory Helper for Tests and Verification Fixtures (U12)
 *
 * Ensures tests NEVER touch or mutate real server/data/ files.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../');
const REAL_DATA_DIR = path.join(ROOT_DIR, 'server/data');

export function createIsolatedTestDataDir(prefix = 'dn42-test-fixture-') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  // Copy template and persistent files to tmpDir for isolation
  if (fs.existsSync(REAL_DATA_DIR)) {
    const files = fs.readdirSync(REAL_DATA_DIR);
    for (const f of files) {
      const src = path.join(REAL_DATA_DIR, f);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(tmpDir, f));
      }
    }
  }

  // Set environment variable to redirect all server data operations to tmpDir
  process.env.PORTAL_DATA_DIR = tmpDir;

  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  };

  return {
    tmpDir,
    cleanup
  };
}
