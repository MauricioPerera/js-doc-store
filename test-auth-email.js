// Test suite for Auth email format validation (issue #3)
// Run: node test-auth-email.js

const { DocStore, MemoryStorageAdapter, Auth } = require('./js-doc-store');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const newAuth = (opts = {}) => {
  const db = new DocStore(new MemoryStorageAdapter());
  const auth = new Auth(db, { secret: 'test', ...opts });
  return auth.init().then(() => auth);
};
const expectThrow = async (fn, msgPart) => {
  try { await fn(); throw new Error('expected to throw'); }
  catch (e) {
    if (msgPart && !e.message.includes(msgPart)) {
      throw new Error(`wrong message: got "${e.message}", expected to contain "${msgPart}"`);
    }
  }
};

(async () => {
  console.log('email validation tests\n');

  // Default behaviour: validation enabled
  await test('valid email accepted', async () => {
    const auth = await newAuth();
    const u = await auth.register('alice@example.com', 'password123', {});
    assert(u._id);
    assert(u.email === 'alice@example.com');
  });

  await test('email lowercased + trimmed', async () => {
    const auth = await newAuth();
    const u = await auth.register('  Alice@Example.COM  ', 'password123', {});
    assert(u.email === 'alice@example.com', `got: ${u.email}`);
  });

  await test('rejects email without @', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('not-an-email', 'password123', {}), 'Invalid email format');
  });

  await test('rejects email without TLD', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('alice@localhost', 'password123', {}), 'Invalid email format');
  });

  await test('rejects email with spaces in local part', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('al ice@example.com', 'password123', {}), 'Invalid email format');
  });

  await test('rejects whitespace-only strings (caught by format validator)', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('   ', 'password123', {}), 'Invalid email format');
  });

  await test('rejects null/empty (caught by required check)', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('', 'password123', {}), 'Email and password required');
    await expectThrow(() => auth.register(null, 'password123', {}), 'Email and password required');
  });

  await test('rejects email with spaces around @', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('alice @example.com', 'password123', {}), 'Invalid email format');
  });

  // Minimal-but-valid edge cases
  await test('accepts a@b.c (RFC simplified minimum)', async () => {
    const auth = await newAuth();
    const u = await auth.register('a@b.c', 'password123', {});
    assert(u._id);
  });

  await test('accepts subdomain emails', async () => {
    const auth = await newAuth();
    const u = await auth.register('alice@mail.example.co.uk', 'password123', {});
    assert(u._id);
  });

  await test('accepts plus-aliased emails', async () => {
    const auth = await newAuth();
    const u = await auth.register('alice+work@example.com', 'password123', {});
    assert(u._id);
  });

  // Opt-out for username-style flows
  await test('validateEmail: false allows non-email identifiers', async () => {
    const auth = await newAuth({ validateEmail: false });
    const u = await auth.register('alice_username', 'password123', {});
    assert(u._id);
    assert(u.email === 'alice_username');
  });

  await test('validateEmail: false still trims + lowercases', async () => {
    const auth = await newAuth({ validateEmail: false });
    const u = await auth.register('  ALICE  ', 'password123', {});
    assert(u.email === 'alice');
  });

  // Login behaviour: still works on existing users
  await test('login succeeds with same email after register', async () => {
    const auth = await newAuth();
    await auth.register('alice@example.com', 'password123', {});
    const { token, user } = await auth.login('alice@example.com', 'password123');
    assert(token);
    assert(user.email === 'alice@example.com');
  });

  await test('login is case-insensitive', async () => {
    const auth = await newAuth();
    await auth.register('alice@example.com', 'password123', {});
    const { token } = await auth.login('ALICE@EXAMPLE.COM', 'password123');
    assert(token);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
