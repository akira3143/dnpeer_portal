import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RULES as DEF_RULES } from '../../shared/rules/definitions.js';
import { RULES as JS_RULES, validateAsn as jsValidateAsn, calcDefaultPort as jsCalcPort } from '../../shared/generated/rules.js';
import { RULES as SVR_RULES, validateAsn as svrValidateAsn, calcDefaultPort as svrCalcPort } from '../../server/utils/validator.js';

describe('Rules Single-Source Consistency Tests', () => {
  test('constants across all generators are identical', () => {
    assert.deepEqual(DEF_RULES, JS_RULES);
    assert.deepEqual(DEF_RULES, SVR_RULES);
  });

  test('port calculation is 100% consistent across JS and Server', () => {
    const testAsns = ['4242420000', '4242423143', 'AS4242429999', '64512', '12345'];
    for (const asn of testAsns) {
      assert.equal(jsCalcPort(asn), svrCalcPort(asn));
    }
  });

  test('validation results match across JS and Server', () => {
    const testCases = [
      '4242423143',
      'AS4242423143',
      'invalid',
      '0',
      '999999999999999'
    ];

    for (const tc of testCases) {
      const jsRes = jsValidateAsn(tc);
      const svrRes = svrValidateAsn(tc);
      assert.equal(jsRes.valid, svrRes.valid, `Mismatch on ASN: ${tc}`);
    }
  });
});
