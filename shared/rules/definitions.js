/**
 * DN42 Peering Portal - Declarative Rule Definitions (Single Source of Truth)
 *
 * This file is the single source of truth for format validation rules,
 * regex patterns, and default formulas across Server, GUI, and CLI.
 */

export const RULES = {
  asn: {
    name: 'ASN',
    description: 'DN42 Autonomous System Number (424242xxxx or 16-bit private)',
    regexStr: '^(424242[0-9]{4}|6451[2-9]|645[2-9][0-9]|64[6-9][0-9]{2}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-4])$',
    dn42RegexStr: '^424242[0-9]{4}$',
    min: 64512,
    max: 4242429999,
    example: '4242423143',
    errorMessage: 'ASN must be within DN42 range (AS4242420000-AS4242429999)'
  },

  publicKey: {
    name: 'WireGuard Public Key',
    description: '44-character Base64 encoded WireGuard Curve25519 public key ending with =',
    regexStr: '^[A-Za-z0-9+/]{43}=$',
    length: 44,
    example: 'yA+N64x7tN/4H1XqJd+7qf3K9z1V8uT5R7o+P2w8x1E=',
    errorMessage: 'WireGuard Public Key must be 44-character Base64 ending with ='
  },

  ipv4: {
    name: 'IPv4 Address / Subnet',
    description: 'Valid DN42 IPv4 address (172.20.0.0/14 or 10.0.0.0/8)',
    regexStr: '^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\\/(?:[0-9]|[12][0-9]|3[0-2]))?$',
    example: '172.20.150.1',
    errorMessage: 'IPv4 must be within DN42 subnet (172.20.0.0/14 or 10.0.0.0/8)'
  },

  endpoint: {
    name: 'Peer Endpoint Hostname / IP',
    regexStr: '^(?:(?:(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])\\.)*(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-]*[a-zA-Z0-9])|(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4}|(?:::|::[0-9a-fA-F:]+|[0-9a-fA-F:]+::[0-9a-fA-F:]*)|(?:\\[[0-9a-fA-F:]+\\]))$',
    example: 'peer.example.dn42',
    errorMessage: 'Endpoint must be a valid hostname or IP (no http:// or :port)'
  },

  ipv6Ula: {
    name: 'IPv6 ULA',
    description: 'DN42 IPv6 Unique Local Address (starts with fd)',
    regexStr: '^fd[0-9a-fA-F]{2}:[0-9a-fA-F:]+(?:\\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$',
    example: 'fd00:4242:3143::1',
    errorMessage: 'IPv6 ULA must start with fd (e.g. fd00:4242:3143::1)'
  },

  linkLocal: {
    name: 'IPv6 Link-Local',
    description: 'IPv6 Link-Local Address (starts with fe80:)',
    regexStr: '^(?:fe80|FE80):(?::|(?:(?::[0-9a-fA-F]{1,4}){1,7})|(?:(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4})|(?:(?:[0-9a-fA-F]{1,4}:){1,7}[0-9a-fA-F]{1,4})|(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6}::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}))(?:\\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))?$',
    example: 'fe80::3143',
    errorMessage: 'Link-Local Address must start with fe80: and be valid IPv6 (e.g. fe80::3143)'
  },

  port: {
    name: 'WireGuard ListenPort',
    description: 'UDP port between 20000 and 65535. Default calculated from ASN',
    min: 20000,
    max: 65535,
    baseOffset: 20000,
    modulo: 10000,
    conflictStep: 10000,
    example: 23143,
    errorMessage: 'Port must be an integer between 20000 and 65535'
  },

  mtu: {
    name: 'MTU',
    description: 'WireGuard MTU (default 1420)',
    default: 1420,
    min: 1280,
    max: 1500,
    errorMessage: 'MTU must be between 1280 and 1500'
  },

  bgpMode: {
    name: 'BGP Mode',
    default: 'mpbgp_enh',
    allowed: ['mpbgp_enh', 'dual_stack', 'ipv6_only'],
    errorMessage: 'BGP mode must be mpbgp_enh, dual_stack, or ipv6_only'
  }
};
