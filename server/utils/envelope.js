/**
 * Unified Envelope Protocol Helpers
 */

export function successEnvelope(data = null, code = 200, meta = {}) {
  return {
    success: true,
    code,
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

export function errorEnvelope(message, fieldErrors = null, code = 200, meta = {}) {
  const errorObj = { message };
  if (fieldErrors && Object.keys(fieldErrors).length > 0) {
    errorObj.fieldErrors = fieldErrors;
  }
  return {
    success: false,
    code,
    error: errorObj,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

export function sendJson(res, statusCode, body) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
  });
  res.end(payload);
}
