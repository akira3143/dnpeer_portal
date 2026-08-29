import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve('server/data');
const initialFiles = fs.readdirSync(dataDir).sort();
console.log('Initial server/data files:', initialFiles);

for (let i = 1; i <= 5; i++) {
  console.log(`\n================ RUN ${i} OF 5 ================`);
  const out = execSync('npm test', { encoding: 'utf8', stdio: 'pipe' });
  const lines = out.trim().split('\n');
  const summaryLine = lines.filter(l => l.includes('tests ') || l.includes('pass ') || l.includes('fail ')).join(' | ');
  console.log(`Run ${i} result: ${summaryLine}`);

  const currentFiles = fs.readdirSync(dataDir).sort();
  if (JSON.stringify(initialFiles) !== JSON.stringify(currentFiles)) {
    console.error(`ERROR on run ${i}: server/data files changed!`, currentFiles);
    process.exit(1);
  }
}

console.log('\nSUCCESS: 5 CONSECUTIVE RUNS PASSED 100% WITH ZERO SERVER/DATA POLLUTION!');
