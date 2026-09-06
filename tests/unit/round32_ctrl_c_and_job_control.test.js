import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('Round 32: Terminal Ctrl+C Interrupt & Controlling TTY / Job Control Fixes', async (t) => {
  const initPath = path.resolve('cli/cli-src/init');
  const loginPath = path.resolve('cli/cli-src/sbin/dn42-login');
  const profilePath = path.resolve('cli/cli-src/etc/profile');
  const libPath = path.resolve('cli/cli-src/etc/dn42-lib.sh');
  const indexPath = path.resolve('cli/public/index.html');
  const rootfsPath = path.resolve('cli/public/rootfs.dat');

  await t.test('1. cli/cli-src/init uses setsid -c to establish session leader and controlling terminal', () => {
    const initContent = fs.readFileSync(initPath, 'utf8');
    assert.match(initContent, /setsid\s+-c/, 'init must use setsid -c');
    assert.match(initContent, /\/bin\/busybox\s+setsid\s+-c\s+\/bin\/busybox\s+cttyhack\s+\/sbin\/dn42-login/, 'init must chain setsid -c with cttyhack');
  });

  await t.test('2. cli/cli-src/sbin/dn42-login restores stty sane, isig, and un-traps INT before exec sh', () => {
    const loginContent = fs.readFileSync(loginPath, 'utf8');
    assert.match(loginContent, /stty\s+sane.*isig/, 'enter_shell must reset terminal attributes to sane/isig mode');
    assert.match(loginContent, /trap\s+-\s+INT/, 'enter_shell must reset INT trap');
    assert.match(loginContent, /exec\s+\/bin\/sh\s+-l/, 'enter_shell must exec login shell');
  });

  await t.test('3. cli/cli-src/etc/profile activates stty sane and job control (set -m)', () => {
    const profileContent = fs.readFileSync(profilePath, 'utf8');
    assert.match(profileContent, /stty\s+sane.*isig/, 'profile must configure terminal sanity with isig');
    assert.match(profileContent, /set\s+-m/, 'profile must ensure job control (set -m) is turned on');
  });

  await t.test('4. cli/cli-src/etc/dn42-lib.sh read_line_edit guarantees isig restoration', () => {
    const libContent = fs.readFileSync(libPath, 'utf8');
    assert.match(libContent, /stty\s+isig/, 'read_line_edit must explicitly ensure isig is enabled');
    assert.match(libContent, /stty\s+icanon\s+echo\s+isig/, 'Fallback stty restore must include isig flag');
  });

  await t.test('5. cli/public/index.html clears text selection on copy and on Enter to prevent swallowing Ctrl+C', () => {
    const indexContent = fs.readFileSync(indexPath, 'utf8');
    assert.match(indexContent, /term\.clearSelection\(\)/, 'index.html must clear selection after copy');
    assert.match(indexContent, /term\.hasSelection\(\)\s*&&\s*\(event\.key\s*===\s*'Enter'/, 'index.html must clear selection on Enter key');
  });

  await t.test('6. rootfs.dat is newly re-generated and non-empty', () => {
    assert.ok(fs.existsSync(rootfsPath), 'rootfs.dat must exist');
    const stat = fs.statSync(rootfsPath);
    assert.ok(stat.size > 500000, 'rootfs.dat should be at least 500KB');
  });
});
