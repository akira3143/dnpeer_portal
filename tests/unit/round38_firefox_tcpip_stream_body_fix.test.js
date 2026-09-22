import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRequestBodyAsBytes } from '../../cli/public/fetch-network.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

describe('Round 38: Firefox / macOS WASM TCP/IP HTTP Stream Body & Parameter Loss Fixes', () => {
  it('1. cli/public/vendor/tcpip-http/dist/index.js explicitly disables De (streaming) to buffer TCP body safely', () => {
    const tcpipHttpDist = fs.readFileSync(
      path.resolve(ROOT_DIR, 'cli/public/vendor/tcpip-http/dist/index.js'),
      'utf8'
    );
    assert.ok(
      tcpipHttpDist.includes('var De=false;'),
      'tcpip-http must have var De=false to force full buffering of TCP bodies via Response.arrayBuffer()'
    );
    assert.ok(
      !tcpipHttpDist.includes('var De=Fe();'),
      'tcpip-http must not use Fe() streaming detection which causes premature handler dispatch on Gecko'
    );
  });

  it('2. cli/public/fetch-network.js busts cache on tcpip-http import', () => {
    const fetchNetSrc = fs.readFileSync(
      path.resolve(ROOT_DIR, 'cli/public/fetch-network.js'),
      'utf8'
    );
    assert.ok(
      fetchNetSrc.includes('import { createHttp } from "./vendor/tcpip-http/dist/index.js?v='),
      'fetch-network.js must include cache busting query parameter on tcpip-http import'
    );
  });

  it('3. readRequestBodyAsBytes extracts body across streams, buffers, and fallbacks', async () => {
    // Case A: Null / no body
    assert.equal(await readRequestBodyAsBytes(null), null);
    const getReq = new Request('http://localhost/', { method: 'GET' });
    assert.equal(await readRequestBodyAsBytes(getReq), null);

    // Case B: Direct Uint8Array / ArrayBuffer / String
    const rawPayload = JSON.stringify({
      asn: 4242421888,
      challengeText: 'test:challenge:string',
      signature: '-----BEGIN SSH SIGNATURE-----\nfake\n-----END SSH SIGNATURE-----'
    });

    const strReq = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawPayload
    });
    const strRes = await readRequestBodyAsBytes(strReq);
    assert.ok(strRes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(strRes), rawPayload);

    // Case C: Standard ReadableStream with getReader
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawPayload.slice(0, 20)));
        controller.enqueue(encoder.encode(rawPayload.slice(20)));
        controller.close();
      }
    });

    const streamReq = new Request('http://localhost/', {
      method: 'POST',
      body: stream,
      duplex: 'half'
    });
    const streamRes = await readRequestBodyAsBytes(streamReq);
    assert.ok(streamRes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(streamRes), rawPayload);
  });

  it('4. readRequestBodyAsBytes does not return empty Uint8Array(0) on ArrayBuffer(0) and logs diagnostics', async () => {
    // Mock a Request object where arrayBuffer() resolves to empty ArrayBuffer(0)
    // but text() returns valid data
    const mockReq = {
      body: new Uint8Array([1, 2, 3]), // truthy body
      arrayBuffer: async () => new ArrayBuffer(0), // empty
      clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      text: async () => 'fallback-text'
    };

    // When body is Uint8Array, it returns directly
    const resDirect = await readRequestBodyAsBytes(mockReq);
    assert.deepEqual(Array.from(resDirect), [1, 2, 3]);

    // When body is a broken stream where arrayBuffer returns ArrayBuffer(0) and Response wrapper fails,
    // it falls back to text()
    const brokenStream = new ReadableStream({
      start(c) {
        c.error(new Error('simulated broken stream'));
      }
    });
    const mockReq2 = {
      body: brokenStream,
      arrayBuffer: async () => new ArrayBuffer(0),
      clone: () => ({ arrayBuffer: async () => new ArrayBuffer(0) }),
      text: async () => '{"recovered":true}'
    };
    const resFallback = await readRequestBodyAsBytes(mockReq2);
    assert.ok(resFallback instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(resFallback), '{"recovered":true}');
  });
});
