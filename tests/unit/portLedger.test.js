import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PortLedgerService } from '../../server/services/portLedgerService.js';
import { DATA_DIR } from '../../server/config.js';

describe('PortLedgerService Unit Tests', () => {
  const ledgerFile = path.join(DATA_DIR, 'port_ledger.json');

  beforeEach(() => {
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
  });

  afterEach(() => {
    fs.writeFileSync(ledgerFile, JSON.stringify({}), 'utf8');
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

  test('P2-2: fallback linear search covers 1024-20000 range when 20000-65535 are occupied', async () => {
    const ledger = await PortLedgerService.getLedger();
    ledger['JP-TYO-1'] = [];
    // Occupy 20000..65535
    for (let p = 20000; p <= 65535; p++) {
      ledger['JP-TYO-1'].push({ port: p, source: 'test_fill' });
    }
    // Also occupy 1024..1050
    for (let p = 1024; p <= 1050; p++) {
      ledger['JP-TYO-1'].push({ port: p, source: 'test_fill' });
    }
    await PortLedgerService.saveLedger(ledger);

    const res = await PortLedgerService.allocateAndLockPort({
      nodeId: 'JP-TYO-1',
      asn: 4242423143,
      requestedPort: 'auto',
      sessionId: 'sess_fallback_test'
    });

    assert.equal(res.port, 1051, 'Fallback must find first free port starting at RULES.port.min (1024)');
    assert.equal(res.isShifted, true);
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
