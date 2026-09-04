import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { RegistryService, parseRpslLines } from '../../server/services/registryService.js';

describe('DN42 Registry Service & Live Sync Unit Tests (Round 20)', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'dn42-test-reg-'));

  after(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {}
  });

  test('RPSL parsing: handles mixed casing, comments, continuation lines, and multiple values', () => {
    const rawRpsl = `
# Comment line to ignore
% Another comment
aut-num:          AS4242423143
AS-NAME:          AKILAB-MNT
descr:            AkiLab DN42 Network
                  High Performance MP-BGP Node
admin-c:          AKIRA-DN42
mnt-by:           AKILAB-MNT
mnt-by:           AKIRA-MNT
source:           DN42
`;
    const records = parseRpslLines(rawRpsl);
    assert.ok(records.some(r => r.key === 'aut-num' && r.value === 'AS4242423143'));
    assert.ok(records.some(r => r.key === 'as-name' && r.value === 'AKILAB-MNT'));
    assert.ok(records.some(r => r.key === 'descr' && r.value.includes('High Performance MP-BGP Node')));
    assert.equal(records.filter(r => r.key === 'mnt-by').length, 2);
  });

  test('Uninitialized repo error: throws clear actionable message with clone command', async () => {
    const emptyDir = path.join(tmpBase, 'non_existent_repo');
    await assert.rejects(
      async () => {
        await RegistryService.syncRegistry(emptyDir);
      },
      /DN42 registry repository not found\. Please clone it first: git clone/
    );

    await assert.rejects(
      async () => {
        await RegistryService.getAsnInfo(4242423143, emptyDir);
      },
      /DN42 registry repository not found\. Please clone it first: git clone/
    );
  });

  test('Local hit: parses aut-num and auth/mntner without git pull', async () => {
    const localRepo = path.join(tmpBase, 'local_hit_repo');
    fs.mkdirSync(path.join(localRepo, '.git'), { recursive: true });
    fs.mkdirSync(path.join(localRepo, 'data', 'aut-num'), { recursive: true });
    fs.mkdirSync(path.join(localRepo, 'data', 'auth'), { recursive: true });
    fs.mkdirSync(path.join(localRepo, 'data', 'mntner'), { recursive: true });

    fs.writeFileSync(path.join(localRepo, 'data', 'aut-num', 'AS4242421234'), `
aut-num:    AS4242421234
as-name:    TEST-PEER-AS
descr:      Test Peer Network
admin-c:    TEST-CONTACT
mnt-by:     TEST-MNT
`);

    const mockKey1 = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGabcdefghijklmnopqrstuvwxyz0123456789ABCDE admin@test';
    const mockKey2 = 'ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBMockKey admin2@test';

    // One in data/auth, one in data/mntner
    fs.writeFileSync(path.join(localRepo, 'data', 'auth', 'TEST-MNT'), `
mntner:     TEST-MNT
auth:       ${mockKey1}
`);
    fs.writeFileSync(path.join(localRepo, 'data', 'mntner', 'TEST-MNT'), `
mntner:     TEST-MNT
auth:       ${mockKey2}
`);

    const info = await RegistryService.getAsnInfo(4242421234, localRepo);
    assert.ok(info, 'Should return parsed info');
    assert.equal(info.asn, 4242421234);
    assert.equal(info.asName, 'TEST-PEER-AS');
    assert.equal(info.adminContact, 'TEST-CONTACT');
    assert.equal(info.maintainer, 'TEST-MNT');
    assert.equal(info.authKeys.length, 2);
    assert.ok(info.authKeys.includes(mockKey1));
    assert.ok(info.authKeys.includes(mockKey2));
  });

  test('Miss and real-time git pull: missing ASN triggers pull, then parses newly synced file', async () => {
    // 1. Create a "remote" bare repo
    const remoteBareDir = path.join(tmpBase, 'remote.git');
    const upstreamWorkDir = path.join(tmpBase, 'upstream_work');
    const downstreamRepo = path.join(tmpBase, 'downstream_repo');

    execFileSync('git', ['init', '--bare', remoteBareDir]);
    execFileSync('git', ['clone', remoteBareDir, upstreamWorkDir]);

    // Setup git author for commit
    execFileSync('git', ['config', 'user.name', 'DN42 CI'], { cwd: upstreamWorkDir });
    execFileSync('git', ['config', 'user.email', 'ci@dn42.dev'], { cwd: upstreamWorkDir });

    // Initial commit in upstream
    fs.mkdirSync(path.join(upstreamWorkDir, 'data', 'aut-num'), { recursive: true });
    fs.mkdirSync(path.join(upstreamWorkDir, 'data', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(upstreamWorkDir, 'README.md'), '# DN42 Registry\n');
    execFileSync('git', ['add', '.'], { cwd: upstreamWorkDir });
    execFileSync('git', ['commit', '-m', 'Initial registry commit'], { cwd: upstreamWorkDir });
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: upstreamWorkDir });

    // 2. Clone downstream
    execFileSync('git', ['clone', remoteBareDir, downstreamRepo]);

    // 3. Query downstream for AS4242429999 (not exists yet)
    const notFound = await RegistryService.getAsnInfo(4242429999, downstreamRepo);
    assert.equal(notFound, null, 'Non-existent ASN should return null after sync');

    // 4. Now add AS4242429999 upstream
    const testKey = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIInewkey99999999999999999999999999999999 user@new';
    fs.writeFileSync(path.join(upstreamWorkDir, 'data', 'aut-num', 'AS4242429999'), `
aut-num:    AS4242429999
as-name:    NEW-COMMUNITY-AS
mnt-by:     NEW-MNT
`);
    fs.writeFileSync(path.join(upstreamWorkDir, 'data', 'auth', 'NEW-MNT'), `
mntner:     NEW-MNT
auth:       ${testKey}
`);
    execFileSync('git', ['add', '.'], { cwd: upstreamWorkDir });
    execFileSync('git', ['commit', '-m', 'Add AS4242429999'], { cwd: upstreamWorkDir });
    execFileSync('git', ['push', 'origin', 'HEAD'], { cwd: upstreamWorkDir });

    // 5. Downstream does NOT have the file yet locally
    assert.ok(!fs.existsSync(path.join(downstreamRepo, 'data', 'aut-num', 'AS4242429999')));

    // 6. Query downstream -> triggers git pull -> returns parsed info!
    const synced = await RegistryService.getAsnInfo(4242429999, downstreamRepo);
    assert.ok(synced, 'Should successfully return synced ASN info');
    assert.equal(synced.asn, 4242429999);
    assert.equal(synced.asName, 'NEW-COMMUNITY-AS');
    assert.equal(synced.authKeys.length, 1);
    assert.equal(synced.authKeys[0], testKey);
  });

  test('Pull failure retry & error: non-zero pull triggers retry and throws standard message', async () => {
    const brokenRepo = path.join(tmpBase, 'broken_repo');
    execFileSync('git', ['init', brokenRepo]);
    execFileSync('git', ['config', 'user.name', 'Tester'], { cwd: brokenRepo });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: brokenRepo });
    // Point remote to non-existent URL so git pull fails
    execFileSync('git', ['remote', 'add', 'origin', 'https://127.0.0.1:9/invalid-repo.git'], { cwd: brokenRepo });

    const startTime = Date.now();
    await assert.rejects(
      async () => {
        await RegistryService.syncRegistry(brokenRepo);
      },
      (err) => {
        assert.equal(err.message, 'Registry sync failed, please retry later');
        return true;
      }
    );
    const elapsed = Date.now() - startTime;
    // Must have waited at least 2000ms for retry
    assert.ok(elapsed >= 1900, `Expected retry sleep of ~2000ms, elapsed: ${elapsed}ms`);
  });

  test('Periodic background sync timer: can start and stop cleanly', () => {
    const timer = RegistryService.startPeriodicSync(100000);
    assert.ok(timer, 'Timer handle should be returned');
    RegistryService.stopPeriodicSync();
  });
});
