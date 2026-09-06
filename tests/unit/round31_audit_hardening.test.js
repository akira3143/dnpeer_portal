import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateEndpoint, validateIpv4 } from '../../server/utils/validator.js';
import { parseSsOutput } from '../../server/services/scannerService.js';

test('Round 31: Pre-Deploy Audit Hardening Unit Tests', async (t) => {
  await t.test('1. H-2: cli/cli-src/bin/peer uses safe awk literal replacement for template draft', () => {
    const peerScript = fs.readFileSync(path.resolve('cli/cli-src/bin/peer'), 'utf8');
    assert.match(peerScript, /safe_replace\(line,\s*"__PUBKEY__",\s*pubkey\)/, 'Must use safe_replace for pubkey');
    assert.match(peerScript, /safe_replace\(line,\s*"__ENDPOINT__",\s*ep\)/, 'Must use safe_replace for endpoint');
    assert.doesNotMatch(peerScript, /sed -i -e "s\|__PUBKEY__/, 'Old sed -i template substitution must not exist');
  });

  await t.test('2. H-3: validateEndpoint accepts IPv6 bare and bracketed addresses without port', () => {
    // Valid domain names
    assert.equal(validateEndpoint('peer.example.dn42').valid, true);
    assert.equal(validateEndpoint('jp1.akilab.net').valid, true);

    // Valid IPv4
    assert.equal(validateEndpoint('172.20.150.1').valid, true);
    assert.equal(validateEndpoint('1.2.3.4').valid, true);

    // Valid IPv6 bare and bracketed
    assert.equal(validateEndpoint('2400:8902::1').valid, true);
    assert.equal(validateEndpoint('[2400:8902::1]').valid, true);
    assert.equal(validateEndpoint('2001:0db8:85a3:0000:0000:8a2e:0370:7334').valid, true);

    // Invalid with protocols or ports
    assert.equal(validateEndpoint('http://peer.example.dn42').valid, false);
    assert.equal(validateEndpoint('peer.example.dn42:23143').valid, false);
    assert.equal(validateEndpoint('1.2.3.4:51820').valid, false);
    assert.equal(validateEndpoint('[2400:8902::1]:51820').valid, false);
  });

  await t.test('3. H-4: deploy-lgproxy.sh and installScriptService.js verify SHA256 integrity', () => {
    const deployLg = fs.readFileSync(path.resolve('scripts/deploy-lgproxy.sh'), 'utf8');
    assert.match(deployLg, /EXPECTED_SHA256=/, 'Must define expected SHA256 in deploy-lgproxy.sh');
    assert.match(deployLg, /sha256sum "\$TMPDIR_DL\/lgproxy\.tar\.gz"/, 'Must compute and verify sha256 in deploy-lgproxy.sh');

    const installService = fs.readFileSync(path.resolve('server/services/installScriptService.js'), 'utf8');
    assert.match(installService, /LG_SHA256=/, 'Must define expected SHA256 in installScriptService.js');
    assert.match(installService, /sha256sum/, 'Must compute and verify sha256 in installScriptService.js');
  });

  await t.test('4. H-5 & M-1: sessionService deleteSession and updateRuntimePeers use commit lock', () => {
    const sessionServiceCode = fs.readFileSync(path.resolve('server/services/sessionService.js'), 'utf8');
    assert.match(sessionServiceCode, /static async deleteSession\([^)]*\)\s*\{\s*return this\.withSessionCommitLock/, 'deleteSession must be wrapped in withSessionCommitLock');
    assert.match(sessionServiceCode, /static async updateRuntimePeers\([^)]*\)\s*\{\s*return this\.withSessionCommitLock/, 'updateRuntimePeers must be wrapped in withSessionCommitLock');
  });

  await t.test('5. M-2: parseSsOutput filters out TCP lines and scannerService uses ss -ulnp', () => {
    const mockMixedSs = [
      'udp   UNCONN 0      0            0.0.0.0:23143      0.0.0.0:*    users:(("wireguard",pid=123,fd=3))',
      'udp   UNCONN 0      0            0.0.0.0:25000      0.0.0.0:*    users:(("custom-daemon",pid=456,fd=12))',
      'tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=100,fd=3))',
      'tcp   LISTEN 0      128          0.0.0.0:3306       0.0.0.0:*    users:(("mysqld",pid=101,fd=4))'
    ].join('\n');

    const systemPorts = parseSsOutput(mockMixedSs, [{ port: 23143, name: 'wg0' }]);
    assert.equal(systemPorts.length, 1);
    assert.equal(systemPorts[0].port, 25000);
    assert.equal(systemPorts[0].name, 'custom-daemon');

    const probeAgentCode = fs.readFileSync(path.resolve('scripts/probe-agent.js'), 'utf8');
    assert.match(probeAgentCode, /ss -ulnp/, 'probe-agent must query UDP sockets only');

    const scannerCode = fs.readFileSync(path.resolve('server/services/scannerService.js'), 'utf8');
    assert.match(scannerCode, /ss -ulnp/, 'scannerService must query UDP sockets only');
  });

  await t.test('6. M-3: deploy/install.sh restricts auth_users.json permissions to 0600', () => {
    const installScript = fs.readFileSync(path.resolve('deploy/install.sh'), 'utf8');
    assert.match(installScript, /chmod 600 "\$AUTH_FILE"/, 'Must explicitly set chmod 600 on auth_users.json');
  });

  await t.test('7. M-4: dn42-lib.sh json_field handles JSON whitespace around colons', () => {
    const dn42Lib = fs.readFileSync(path.resolve('cli/cli-src/etc/dn42-lib.sh'), 'utf8');
    assert.match(dn42Lib, /match\(\$0,\s*pat\)/, 'json_field must use match with whitespace-tolerant regex');
  });

  await t.test('8. M-5: build_rootfs.js differentiates executable and data file modes in CPIO archive', () => {
    const buildCode = fs.readFileSync(path.resolve('cli/build_rootfs.js'), 'utf8');
    assert.match(buildCode, /isExecutable \? 0o100755 : 0o100644/, 'build_rootfs must set 0644 for configs and 0755 for binaries');
  });

  await t.test('9. M-6: LookingGlass.tsx validates target before submitting route query', () => {
    const lgTsx = fs.readFileSync(path.resolve('gui/src/components/LookingGlass.tsx'), 'utf8');
    assert.match(lgTsx, /if \(qtype === 'route'\)/, 'Must check route query type');
    assert.match(lgTsx, /Please specify an IP, CIDR subnet, or ASN/, 'Must validate non-empty target input');
  });

  await t.test('10. L-2: deploy/uninstall.sh removes /usr/local/bin/dnp', () => {
    const uninstallScript = fs.readFileSync(path.resolve('deploy/uninstall.sh'), 'utf8');
    assert.match(uninstallScript, /rm -f "\/usr\/local\/bin\/dnp"/, 'Must remove /usr/local/bin/dnp in uninstall.sh');
  });

  await t.test('11. L-3: validateIpv4 in server and generator strips leading zeros for safe base-10 comparison', () => {
    const generatorCode = fs.readFileSync(path.resolve('shared/rules/generator.js'), 'utf8');
    assert.ok(generatorCode.includes('{_o#0}'), 'Shell generator must strip leading zeros');

    assert.equal(validateIpv4('172.20.150.1').valid, true);
    assert.equal(validateIpv4('172.23.1.1').valid, true);
    assert.equal(validateIpv4('10.0.0.1').valid, true);
  });
});
