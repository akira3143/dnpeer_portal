import { hashPassword } from '../../server/services/authService.js';

export function createTestUsers() {
  const akiraPass = hashPassword('test12345');
  const user1Pass = hashPassword('test12345');

  return {
    '4242423143': {
      asn: 4242423143,
      asName: 'AKILAB-MNT',
      role: 'admin',
      salt: akiraPass.salt,
      hash: akiraPass.hash,
      createdAt: '2026-08-28T00:00:00.000Z'
    },
    '4141410001': {
      asn: 4141410001,
      asName: 'TEST-AS1',
      role: 'user',
      salt: user1Pass.salt,
      hash: user1Pass.hash,
      createdAt: '2026-08-28T00:00:00.000Z'
    }
  };
}
