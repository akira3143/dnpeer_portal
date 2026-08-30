import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('server/data');
const getDirSnapshot = () => {
  const files = fs.readdirSync(dataDir).sort();
  const snapshot = {};
  for (const f of files) {
    const full = path.join(dataDir, f);
    const stat = fs.statSync(full);
    const content = fs.readFileSync(full);
    snapshot[f] = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      sha: content.toString('base64')
    };
  }
  return snapshot;
};

const initialSnapshot = getDirSnapshot();
console.log('Initial server/data files verified:', Object.keys(initialSnapshot));

for (let i = 1; i <= 5; i++) {
  console.log(`\n================ RUN ${i} OF 5 ================`);
  const out = execSync('npm test', { encoding: 'utf8', stdio: 'pipe' });
  const lines = out.trim().split('\n');
  const summaryLine = lines.filter(l => l.includes('tests ') || l.includes('pass ') || l.includes('fail ')).join(' | ');
  console.log(`Run ${i} result: ${summaryLine}`);

  const currentSnapshot = getDirSnapshot();
  for (const [file, info] of Object.entries(initialSnapshot)) {
    if (!currentSnapshot[file]) {
      console.error(`ERROR on run ${i}: ${file} was deleted!`);
      process.exit(1);
    }
    if (currentSnapshot[file].sha !== info.sha) {
      console.error(`ERROR on run ${i}: ${file} content was mutated!`);
      process.exit(1);
    }
    if (currentSnapshot[file].mtimeMs !== info.mtimeMs) {
      console.error(`ERROR on run ${i}: ${file} mtime was touched!`);
      process.exit(1);
    }
  }
}

console.log('\nSUCCESS: 5 CONSECUTIVE RUNS PASSED 100% WITH ZERO SERVER/DATA CONTENT/MTIME MUTATION!');
