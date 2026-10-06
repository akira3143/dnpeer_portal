import test from 'node:test';
import assert from 'node:assert/strict';
import { recordSessionTrafficMetrics } from '../../server/services/sessionService.js';

test('Round 41: Dual Heartbeat Radar Scope & 24h Traffic Telemetry', async (t) => {
  await t.test('1. recordSessionTrafficMetrics initializes series and computes 24h volume', () => {
    const session = { id: 'test_session_1', runtime: {} };
    const peer = { rxBytes: 1048576, txBytes: 2097152 }; // 1MB Rx, 2MB Tx

    recordSessionTrafficMetrics(session, peer);

    assert.equal(session.runtime.rxBytes, 1048576);
    assert.equal(session.runtime.txBytes, 2097152);
    assert.equal(session.runtime.rx24h, 1048576);
    assert.equal(session.runtime.tx24h, 2097152);
    assert.equal(session.runtime.trafficSeries.length, 1);
  });

  await t.test('2. recordSessionTrafficMetrics computes rolling 24h delta against oldest point', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const session = {
      id: 'test_session_2',
      runtime: {
        trafficSeries: [
          { t: nowSec - 3600, rx: 1000000, tx: 500000 } // 1 hour ago
        ]
      }
    };
    const peer = { rxBytes: 3000000, txBytes: 1500000 };

    recordSessionTrafficMetrics(session, peer);

    // Delta should be (3000000 - 1000000) = 2000000 Rx, (1500000 - 500000) = 1000000 Tx
    assert.equal(session.runtime.rx24h, 2000000);
    assert.equal(session.runtime.tx24h, 1000000);
    assert.equal(session.runtime.trafficSeries.length, 2);
  });

  await t.test('3. recordSessionTrafficMetrics handles node reboot / counter reset gracefully', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const session = {
      id: 'test_session_3',
      runtime: {
        trafficSeries: [
          { t: nowSec - 3600, rx: 50000000, tx: 50000000 } // high counters before reboot
        ]
      }
    };
    // Counter reset after reboot
    const peer = { rxBytes: 10000, txBytes: 5000 };

    recordSessionTrafficMetrics(session, peer);

    // Should fall back to current values without negative numbers
    assert.equal(session.runtime.rx24h, 10000);
    assert.equal(session.runtime.tx24h, 5000);
  });

  await t.test('4. recordSessionTrafficMetrics prunes points older than 24h and caps at 48 points', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const oldPoints = [
      { t: nowSec - 90000, rx: 100, tx: 100 }, // > 24h ago, must be pruned
      { t: nowSec - 85000, rx: 200, tx: 200 }  // < 24h ago, must be kept
    ];

    const session = {
      id: 'test_session_4',
      runtime: {
        trafficSeries: oldPoints
      }
    };

    const peer = { rxBytes: 1000, txBytes: 1000 };
    recordSessionTrafficMetrics(session, peer);

    // Point 1 (90000s ago) should be pruned
    assert.ok(!session.runtime.trafficSeries.some(p => p.t === nowSec - 90000));
    assert.ok(session.runtime.trafficSeries.some(p => p.t === nowSec - 85000));
  });
});
