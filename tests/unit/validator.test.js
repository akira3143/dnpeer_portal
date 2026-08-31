import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAsn,
  validatePublicKey,
  validateIpv4,
  validateEndpoint,
  validateIpv6Ula,
  validateLinkLocal,
  validatePort,
  validateMtu,
  calcDefaultPort,
  formatDefaultLinkLocal,
  validatePeeringSubmission,
  normalizeAsn
} from '../../server/utils/validator.js';

describe('Authoritative Validator Unit Tests', () => {
  describe('ASN Validation (U17 DN42 Range)', () => {
    test('validates standard DN42 ASN', () => {
      const res = validateAsn('4242423143');
      assert.equal(res.valid, true);
      assert.equal(res.value, 4242423143);
    });

    test('validates ASN with AS prefix and 16-bit private ASN', () => {
      const res = validateAsn('AS4242423143');
      assert.equal(res.valid, true);
      assert.equal(res.value, 4242423143);

      const resPriv = validateAsn('64512');
      assert.equal(resPriv.valid, true);
      assert.equal(resPriv.value, 64512);
    });

    test('rejects public ASN outside DN42 range (U17)', () => {
      assert.equal(validateAsn('15169').valid, false, 'Public ASN 15169 must be rejected');
      assert.equal(validateAsn('12345').valid, false, 'Public ASN 12345 must be rejected');
      assert.equal(validateAsn('4242430000').valid, false, 'Outside 424242xxxx must be rejected');
    });

    test('rejects non-numeric and empty ASN', () => {
      assert.equal(validateAsn('AS_INVALID').valid, false);
      assert.equal(validateAsn('').valid, false);
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

  describe('IP & Endpoint Validation (U17)', () => {
    test('validates IPv4 address in DN42 subnets (172.20.0.0/14 or 10.0.0.0/8)', () => {
      assert.equal(validateIpv4('172.20.150.1').valid, true);
      assert.equal(validateIpv4('172.23.255.1').valid, true);
      assert.equal(validateIpv4('10.0.0.1/32').valid, true);
    });

    test('rejects public IPv4 and private LAN 192.168.x.x (U17)', () => {
      assert.equal(validateIpv4('1.1.1.1').valid, false, 'Public IP 1.1.1.1 must be rejected');
      assert.equal(validateIpv4('8.8.8.8').valid, false, 'Public IP 8.8.8.8 must be rejected');
      assert.equal(validateIpv4('192.168.1.1').valid, false, 'LAN IP 192.168.1.1 must be rejected');
      assert.equal(validateIpv4('256.0.0.1').valid, false);
      assert.equal(validateIpv4('not-an-ip').valid, false);
    });

    test('validates Endpoint hostname syntax and rejects protocols/ports (U17)', () => {
      assert.equal(validateEndpoint('myhost.dn42').valid, true);
      assert.equal(validateEndpoint('jp1.akilab.dn42').valid, true);
      assert.equal(validateEndpoint('http://myhost.dn42').valid, false, 'http:// prefix must be rejected');
      assert.equal(validateEndpoint('https://myhost.dn42').valid, false, 'https:// prefix must be rejected');
      assert.equal(validateEndpoint('myhost.dn42:23143').valid, false, 'Port suffix must be rejected');
      assert.equal(validateEndpoint('invalid host space').valid, false);
    });

    test('validates IPv6 ULA starting with fd', () => {
      assert.equal(validateIpv6Ula('fd00:4242:3143::1').valid, true);
      assert.equal(validateIpv6Ula('fda0:1234::1/64').valid, true);
      assert.equal(validateIpv6Ula('2001:db8::1').valid, false);
    });

    test('validates Link-Local starting with fe80: and rejects illegal hextets (U14)', () => {
      assert.equal(validateLinkLocal('fe80::4242:3143').valid, true);
      assert.equal(validateLinkLocal('fe80::3143').valid, true);
      assert.equal(validateLinkLocal('fe80::1').valid, true);
      assert.equal(validateLinkLocal('fe80::3143/64').valid, true);
      assert.equal(validateLinkLocal('fe80::4242423143').valid, false, 'fe80::4242423143 must be rejected');
      assert.equal(validateLinkLocal('fe80::12345').valid, false, 'Hextet > 4 chars must be rejected');
      assert.equal(validateLinkLocal('fd00::1').valid, false);
      assert.equal(formatDefaultLinkLocal('4242423143'), 'fe80::3143', 'Default LLA must format with last 4 digits');
    });
  });

  describe('Port and MTU Validation', () => {
    test('validates port range (20000-65535) and auto mode', () => {
      assert.equal(validatePort('auto').valid, true);
      assert.equal(validatePort(20000).valid, true);
      assert.equal(validatePort(22466).valid, true);
      assert.equal(validatePort(65535).valid, true);
      assert.equal(validatePort(19999).valid, false);
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
        endpoint: 'node.example.dn42',
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
