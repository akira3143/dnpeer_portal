/**
 * Shell Argument and String Sanitizer
 */

export function sanitizeShellArg(str) {
  if (typeof str !== 'string') return '';
  // Remove control characters, null bytes, backticks, dollar signs, semicolons, pipes, redirects, quotes
  return str.replace(/[\x00-\x1f\x7f`$;|&><"'\\!]/g, '');
}

export function sanitizeSafeString(str, maxLen = 256) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLen);
}
