import fs from 'node:fs';
import path from 'node:path';

/**
 * Safely resolves a requested relative path within a designated root directory.
 * 
 * Guards against:
 * 1. Path traversal via `..` or encoded equivalents (%2e%2e, %2f, etc.)
 * 2. Absolute paths on POSIX (leading `/`) or Windows (leading `C:\` or `\\unc`)
 * 3. Null byte injection (%00, \0)
 * 4. Sibling directory prefix attacks (e.g. `baseDir-backup` vs `baseDir`)
 * 5. Symlink breakouts outside root directory
 * 6. File extension restriction (optional whitelist)
 * 
 * @param {string} rootDir - Absolute path to base directory.
 * @param {string} requestedPath - Untrusted request relative path (URI or plain).
 * @param {object} [options]
 * @param {string[]} [options.allowedExtensions] - Lowercase allowed file extensions (e.g. ['.png', '.svg'])
 * @param {boolean} [options.allowDirectory=false] - Whether directories are allowed (default false)
 * @returns {string|null} Resolved absolute file path if safe and contained, or null if invalid.
 */
export function safeResolveStaticPath(rootDir, requestedPath, options = {}) {
  const { allowedExtensions = null, allowDirectory = false } = options;

  if (!requestedPath || typeof requestedPath !== 'string') {
    return null;
  }

  // Reject null bytes immediately
  if (requestedPath.includes('\0')) {
    return null;
  }

  // Safely decode URI components (e.g. %20, %2f)
  let decodedPath = requestedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    return null;
  }

  if (decodedPath.includes('\0')) {
    return null;
  }

  // Reject paths that start with '/' or '\', or are absolute paths (POSIX or Windows)
  if (/^[\/\\]/.test(decodedPath) || path.isAbsolute(decodedPath)) {
    return null;
  }

  // Reject Windows drive letters (e.g. C:, D:) or UNC network paths (\\server\share)
  if (/^[a-zA-Z]:/.test(decodedPath)) {
    return null;
  }

  // Reject explicit path traversal segments
  const segments = decodedPath.split(/[\/\\]/);
  if (segments.some(seg => seg === '..')) {
    return null;
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(resolvedRoot, decodedPath);

  // Containment check via path.relative
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    return null;
  }

  // Strict prefix check with path separator to avoid sibling directory bypass (SEC-10)
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + path.sep)) {
    return null;
  }

  // Optional extension whitelist check
  if (allowedExtensions && Array.isArray(allowedExtensions)) {
    const ext = path.extname(resolvedTarget).toLowerCase();
    if (!allowedExtensions.map(e => e.toLowerCase()).includes(ext)) {
      return null;
    }
  }

  // If the target exists on disk, perform realpath check to prevent symlink traversal
  if (fs.existsSync(resolvedTarget)) {
    try {
      const realTarget = fs.realpathSync(resolvedTarget);
      const realRoot = fs.realpathSync(resolvedRoot);
      const realRel = path.relative(realRoot, realTarget);
      if (realRel === '..' || realRel.startsWith('..' + path.sep) || path.isAbsolute(realRel)) {
        return null;
      }
      if (!allowDirectory && fs.statSync(realTarget).isDirectory()) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return resolvedTarget;
}
