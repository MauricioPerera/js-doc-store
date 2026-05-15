// Regression test for issue #22:
// https://github.com/MauricioPerera/js-doc-store/issues/22
//
// auth_* and field_encrypt/decrypt failed with terse errors that did not say
// which env var was missing or how to set it. This test pins the actionable
// error messages and the guards.

const {
  AUTH_SETUP_HELP,
  ENCRYPTION_SETUP_HELP,
  requireAuthSecret,
  requireEncryptionKey,
} = require('./schema-security-utils.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

// --- Help messages mention the env var name and a restart example ---
assert('AUTH help names AUTH_SECRET',         /AUTH_SECRET/.test(AUTH_SETUP_HELP));
assert('AUTH help mentions restart',          /Restart/i.test(AUTH_SETUP_HELP));
assert('AUTH help has openssl example',       /openssl rand/.test(AUTH_SETUP_HELP));
assert('AUTH help lists affected tools',      /auth_register/.test(AUTH_SETUP_HELP));

assert('ENC help names ENCRYPTION_KEY',       /ENCRYPTION_KEY/.test(ENCRYPTION_SETUP_HELP));
assert('ENC help mentions restart',           /Restart/i.test(ENCRYPTION_SETUP_HELP));
assert('ENC help has openssl example',        /openssl rand/.test(ENCRYPTION_SETUP_HELP));
assert('ENC help lists affected tools',       /field_encrypt/.test(ENCRYPTION_SETUP_HELP));

// --- Guards throw the help message ---
try {
  requireAuthSecret(null);
  console.error('FAIL: requireAuthSecret(null) did not throw');
  process.exit(1);
} catch (err) {
  assert('requireAuthSecret(null) throws AUTH help', err.message === AUTH_SETUP_HELP);
}

try {
  requireEncryptionKey(null);
  console.error('FAIL: requireEncryptionKey(null) did not throw');
  process.exit(1);
} catch (err) {
  assert('requireEncryptionKey(null) throws ENC help', err.message === ENCRYPTION_SETUP_HELP);
}

// --- Guards pass through valid values ---
const fakeAuth = { ok: true };
assert('requireAuthSecret returns instance',  requireAuthSecret(fakeAuth) === fakeAuth);
assert('requireEncryptionKey returns key',    requireEncryptionKey('abc12345') === 'abc12345');

// --- Tool descriptions in the server file mention the requirement ---
const fs = require('fs');
const path = require('path');
const serverSrc = fs.readFileSync(path.join(__dirname, 'schema-designer-server.js'), 'utf8');

assert('auth_register description flags AUTH_SECRET',
  /server\.tool\("auth_register", "\[REQUIRES AUTH_SECRET/.test(serverSrc));
assert('auth_login description flags AUTH_SECRET',
  /server\.tool\("auth_login", "\[REQUIRES AUTH_SECRET/.test(serverSrc));
assert('auth_assign_role description flags AUTH_SECRET',
  /server\.tool\("auth_assign_role", "\[REQUIRES AUTH_SECRET/.test(serverSrc));
assert('field_encrypt description flags ENCRYPTION_KEY',
  /server\.tool\("field_encrypt", "\[REQUIRES ENCRYPTION_KEY/.test(serverSrc));
assert('field_decrypt description flags ENCRYPTION_KEY',
  /server\.tool\("field_decrypt", "\[REQUIRES ENCRYPTION_KEY/.test(serverSrc));
assert('rotate_encryption_key description flags both',
  /server\.tool\("rotate_encryption_key", "\[REQUIRES ENCRYPTION_KEY/.test(serverSrc));

// --- Usage guide includes Security section ---
assert('usage guide has Security & Auth section',
  /## Security & Auth[\s\S]*AUTH_SECRET[\s\S]*ENCRYPTION_KEY/.test(serverSrc));

console.log('\nAll assertions passed.');
