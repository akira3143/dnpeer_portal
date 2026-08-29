import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PortLedgerService } from '../../server/services/portLedgerService.js';
import { DATA_DIR } from '../../server/config.js';

describe('PortLedgerService Unit Tests', () => {
  const ledgerFile = path.join(DATA_DIR, 'port_ledger.json');
  let originalLedgerContent = null;

  beforeEach(() => {
    if (fs.existsSync(ledgerFile)) {
      originalLedgerContent = fs.readFileSync(ledgerFile, 'utf8');
    }
    // Clean test ledger
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  afterEach(() => {
    if (originalLedgerContent !== null) {
      fs.writeFileSync(ledgerFile, originalLedgerContent, 'utf8');
    } else if (fs.existsSync(ledgerFile)) {
      fs.unlinkSync(ledgerFile);
    }
  });

  test('allocates default formula port 20000 + (asn % 10000)', async () => {
    const res = await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4242423143,
      requestedPort: 'auto',
      sessionId: 'test_sess_1'
    });

    assert.equal(res.port, 23143);
    assert.equal(res.isShifted, false);
    assert.equal(res.expectedPort, 23143);

    const isOccupied = await PortLedgerService.isPortOccupied('JP-TYO-1', 23143);
    assert.equal(isOccupied, true);
  });

  test('auto-shifts port by +10000 on collision', async () => {
    // First peer takes 23143
    const res1 = await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4242423143,
      requestedPort: 'auto',
      sessionId: 'sess_user_1'
    });
    assert.equal(res1.port, 23143);

    // Second peer with same ASN/hash on same node gets shifted to 33143
    const res2 = await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4141413143,
      requestedPort: 'auto',
      sessionId: 'sess_user_2'
    });
    assert.equal(res2.port, 33143);
    assert.equal(res2.isShifted, true);
    assert.equal(res2.expectedPort, 23143);

    // Third peer gets shifted to 43143
    const res3 = await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4242423143,
      requestedPort: 'auto',
      sessionId: 'sess_user_3'
    });
    assert.equal(res3.port, 43143);
    assert.equal(res3.isShifted, true);
  });

  test('releases port when session is deleted', async () => {
    await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4242423143,
      requestedPort: 22466,
      sessionId: 'sess_to_delete'
    });

    assert.equal(await PortLedgerService.isPortOccupied('JP-TYO-1', 22466), true);

    await PortLedgerService.releaseSessionPort('JP-TYO-1', 'sess_to_delete');
    assert.equal(await PortLedgerService.isPortOccupied('JP-TYO-1', 22466), false);
  });

  test('merges system ports from probe agent snapshot', async () => {
    await PortLedgerService.mergeProbeReport('JP-TYO-1', {
      ports: [{ port: 22466, name: 'wg0' }],
      systemPorts: [{ port: 21000, name: 'myservice' }]
    });

    assert.equal(await PortLedgerService.isPortOccupied('JP-TYO-1', 21000), true);
    assert.equal(await PortLedgerService.isPortOccupied('JP-TYO-1', 22466), true);
  });
});
