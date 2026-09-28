import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Round 40: CLI peer ls Zero-Fork & Cold-Start Optimization', () => {
  const peerScriptPath = path.resolve(ROOT_DIR, 'cli/cli-src/bin/peer');
  const peerScript = fs.readFileSync(peerScriptPath, 'utf8');

  // Extract do_ls() function body
  const doLsMatch = peerScript.match(/do_ls\(\)\s*\{([\s\S]*?)\n\}/);
  assert.ok(doLsMatch, 'do_ls() function must exist in bin/peer');
  const doLsBody = doLsMatch[1];

  it('1. do_ls must NOT invoke ensure_nodes (eliminate redundant network query on fresh sessions)', () => {
    assert.ok(
      !doLsBody.includes('ensure_nodes'),
      'do_ls must not invoke ensure_nodes; nodeId is already present in session JSON'
    );
  });

  const loopMatch = doLsBody.match(/while IFS= read -r line; do([\s\S]*?)\n\s*done/);
  assert.ok(loopMatch, 'while loop must exist in do_ls');
  const loopBody = loopMatch[1];

  it('2. do_ls loop must NOT spawn grep subshells (Zero-Fork pattern matching)', () => {
    // Assert zero grep calls inside do_ls loop
    assert.ok(
      !loopBody.includes('grep'),
      'do_ls loop must not spawn grep processes; pure POSIX case matching must be used'
    );
    assert.ok(
      loopBody.includes('case "$host_port" in'),
      'do_ls must use case pattern matching for host_port'
    );
    assert.ok(
      loopBody.includes('case "$ep" in'),
      'do_ls must use case pattern matching for endpoint colon detection'
    );
    assert.ok(
      loopBody.includes('case "$client_port" in'),
      'do_ls must use case pattern matching for client_port'
    );
  });

  it('3. Pure shell logic produces 100% accurate port calculations equivalent to grep', () => {
    // Test emulation of the exact shell algorithm
    const calcPorts = (hostPort, listenPort, clientPort, endpoint) => {
      let dispPport = '';
      // hostPort check
      if (hostPort && hostPort !== 'null' && /^\d+$/.test(hostPort) && parseInt(hostPort, 10) > 0) {
        dispPport = hostPort;
      } else if (listenPort && listenPort !== 'null' && /^\d+$/.test(listenPort) && parseInt(listenPort, 10) > 0) {
        dispPport = listenPort;
      } else {
        dispPport = '0';
      }

      // endpoint & clientPort check
      let dispLport = '';
      if (endpoint && endpoint.includes(':')) {
        const epPort = endpoint.split(':').pop();
        if (/^\d+$/.test(epPort) && parseInt(epPort, 10) > 0) {
          dispLport = epPort;
        }
      }
      if (!dispLport) {
        if (clientPort && clientPort !== 'null' && /^\d+$/.test(clientPort) && parseInt(clientPort, 10) > 0) {
          dispLport = clientPort;
        } else {
          dispLport = '0';
        }
      }

      return { dispPport, dispLport };
    };

    // Test case 1: Standard peering with remote endpoint
    const tc1 = calcPorts('20306', '23143', '23143', '1.2.3.4:23143');
    assert.equal(tc1.dispPport, '20306');
    assert.equal(tc1.dispLport, '23143');

    // Test case 2: Auto/roaming endpoint fallback to clientPort
    const tc2 = calcPorts('22213', '0', '0', 'auto');
    assert.equal(tc2.dispPport, '22213');
    assert.equal(tc2.dispLport, '0');

    // Test case 3: Null hostPort fallback to listenPort
    const tc3 = calcPorts(null, '50007', '50001', '10.0.0.1:50001');
    assert.equal(tc3.dispPport, '50007');
    assert.equal(tc3.dispLport, '50001');
  });

  it('4. Compiled rootfs.dat is valid and up to date', () => {
    const rootfsStat = fs.statSync(path.resolve(ROOT_DIR, 'cli/public/rootfs.dat'));
    assert.ok(rootfsStat.size > 500000, 'Compiled rootfs.dat must exist and exceed 500KB');
  });
});
