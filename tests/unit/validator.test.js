import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAsn,
  validatePublicKey,
  validateIpv4,
  validateIpv6Ula,
  validateLinkLocal,
  validatePort,
  validateMtu,
  calcDefaultPort,
  validatePeeringSubmission,
  normalizeAsn
} from '../../server/utils/validator.js';

describe('Authoritative Validator Unit Tests', () => {
  describe('ASN Validation', () => {
    test('validates standard DN42 ASN', () => {
      const res = validateAsn('4242423143');
      assert.equal(res.valid, true);
      assert.equal(res.value, 4242423143);
    });

    test('validates ASN with AS prefix', () => {
      const res = validateAsn('AS4242423143');
      assert.equal(res.valid, true);
      assert.equal(res.value, 4242423143);
    });

    test('rejects non-numeric ASN', () => {
      const res = validateAsn('AS_INVALID');
      assert.equal(res.valid, false);
      assert.ok(res.error);
    });

    test('rejects empty ASN', () => {
      const res = validateAsn('');
      assert.equal(res.valid, false);
    });

    test('calculates default port from ASN correctly', () => {
      assert.equal(calcDefaultPort('4242423143'), 23143);
      assert.equal(calcDefaultPort('AS4242420001'), 20001);
      assert.equal(calcDefaultPort('4242429999'), 29999);
    });
  });

  describe('WireGuard Public Key Validation', () => {
    test('validates valid 44-char base64 key ending with =', () => {
      const res = validatePublicKey('yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=');
      assert.equal(res.valid, true);
      assert.equal(res.value, 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=');
    });

    test('rejects key without = suffix', () => {
      const res = validatePublicKey('yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E');
      assert.equal(res.valid, false);
    });

    test('rejects key with invalid length or chars', () => {
      const res = validatePublicKey('short_key=');
      assert.equal(res.valid, false);
      const res2 = validatePublicKey('yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E*');
      assert.equal(res2.valid, false);
    });
  });

  describe('IP Validation', () => {
    test('validates IPv4 address and CIDR', () => {
      assert.equal(validateIpv4('172.20.150.1').valid, true);
      assert.equal(validateIpv4('10.0.0.1/32').valid, true);
      assert.equal(validateIpv4('256.0.0.1').valid, false);
      assert.equal(validateIpv4('not-an-ip').valid, false);
    });

    test('validates IPv6 ULA starting with fd', () => {
      assert.equal(validateIpv6Ula('fd00:4242:3143::1').valid, true);
      assert.equal(validateIpv6Ula('fda0:1234::1/64').valid, true);
      assert.equal(validateIpv6Ula('2001:db8::1').valid, false);
    });

    test('validates Link-Local starting with fe80:', () => {
      assert.equal(validateLinkLocal('fe80::4242:3143').valid, true);
      assert.equal(validateLinkLocal('fe80::1').valid, true);
      assert.equal(validateLinkLocal('fd00::1').valid, false);
    });
  });

  describe('Port and MTU Validation', () => {
    test('validates port range and auto mode', () => {
      assert.equal(validatePort('auto').valid, true);
      assert.equal(validatePort(22466).valid, true);
      assert.equal(validatePort(1023).valid, false);
      assert.equal(validatePort(65536).valid, false);
    });

    test('validates MTU range and default', () => {
      assert.equal(validateMtu(null).value, 1420);
      assert.equal(validateMtu(1420).valid, true);
      assert.equal(validateMtu(1200).valid, false);
      assert.equal(validateMtu(1600).valid, false);
    });
  });

  describe('Full Peering Submission Validation', () => {
    test('accepts valid submission payload', () => {
      const payload = {
        asn: '4242423143',
        nodeId: 'JP-TYO-1',
        publicKey: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
        linkLocal: 'fe80::4242:3143',
        ipv4: '172.20.150.1',
        ipv6Ula: 'fd00:4242:3143::1',
        endpoint: 'node.example.dn42:23143',
        listenPort: 'auto',
        mtu: 1420,
        bgpMode: 'mpbgp_enh'
      };

      const result = validatePeeringSubmission(payload);
      assert.equal(result.valid, true);
      assert.deepEqual(result.fieldErrors, {});
      assert.equal(result.normalized.asn, 4242423143);
      assert.equal(result.normalized.listenPort, 'auto');
    });

    test('collects field errors for invalid submission', () => {
      const payload = {
        asn: 'invalid_asn',
        nodeId: '',
        publicKey: 'short',
        linkLocal: '1.2.3.4'
      };

      const result = validatePeeringSubmission(payload);
      assert.equal(result.valid, false);
      assert.ok(result.fieldErrors.asn);
      assert.ok(result.fieldErrors.nodeId);
      assert.ok(result.fieldErrors.publicKey);
      assert.ok(result.fieldErrors.linkLocal);
    });
  });
});
