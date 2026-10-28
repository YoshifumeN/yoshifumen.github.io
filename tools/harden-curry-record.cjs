'use strict';
// Narrow, deterministic edit to the large Curry Records HTML.
// Do not log its embedded records, images or executable script bodies.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const file = path.resolve(__dirname, '..', 'curry-record.html');
const before = fs.readFileSync(file, 'utf8');

const scripts = [...before.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
assert.equal(scripts.length, 2, 'Expected exactly two inline scripts; investigate before modifying');
assert(scripts.every(m => !/\bsrc\s*=/i.test(m[1])), 'External script tag found');
const hashes = scripts.map(m => {
  // HTML parsing normalizes CRLF/CR to LF in inline script text.
  const text = m[2].replace(/\r\n?/g, '\n');
  return "'sha256-" + crypto.createHash('sha256').update(text, 'utf8').digest('base64') + "'";
});
const policy = [
  "default-src 'none'",
  'script-src ' + hashes.join(' '),
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');
const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">';
const existing = /<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy))[^>]*>/i;
const head = /<head\b[^>]*>/i;
assert(head.test(before), 'HTML head tag missing');
let after, withoutMeta;
if (existing.test(before)) {
  after = before.replace(existing, meta);
  withoutMeta = after.replace(meta, '');
  assert.equal(withoutMeta, before.replace(existing, ''), 'CSP replacement unexpectedly changed page contents');
} else {
  const nl = before.includes('\r\n') ? '\r\n' : '\n';
  after = before.replace(head, m => m + nl + meta);
  withoutMeta = after.replace(meta, '');
  assert.equal(withoutMeta, before.replace(head, m => m + nl), 'CSP insertion unexpectedly changed page contents');
}
assert.equal([...after.matchAll(/<meta\b(?=[^>]*\bhttp-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy))[^>]*>/gi)].length,1,'Multiple CSP tags');
if (after !== before) fs.writeFileSync(file, after, 'utf8');
console.log('Curry CSP: inline script hashes=' + hashes.length + '; changed=' + (after !== before));
console.log('Curry CSP: embedded data, scripts, photographs and existing layout preserved');
