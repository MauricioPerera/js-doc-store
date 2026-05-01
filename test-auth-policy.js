// Test suite for Auth.passwordPolicy (issue #2)
// Run: node test-auth-policy.js

const { DocStore, MemoryStorageAdapter, Auth } = require('./js-doc-store');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const newAuth = (policy) => {
  const db = new DocStore(new MemoryStorageAdapter());
  const auth = new Auth(db, { secret: 'test', passwordPolicy: policy });
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
  console.log('passwordPolicy tests\n');

  // Backward compatibility — no policy = default minLength 6
  await test('default policy: 5 chars rejected', async () => {
    const auth = await newAuth();
    await expectThrow(() => auth.register('a@x.com', 'short', {}), 'at least 6');
  });
  await test('default policy: 6 chars accepted', async () => {
    const auth = await newAuth();
    const u = await auth.register('a@x.com', 'sixchr', {});
    assert(u._id, 'expected user');
  });

  // minLength
  await test('minLength=12: 11 chars rejected', async () => {
    const auth = await newAuth({ minLength: 12 });
    await expectThrow(() => auth.register('a@x.com', 'eleven_char', {}), 'at least 12');
  });
  await test('minLength=12: 12 chars accepted', async () => {
    const auth = await newAuth({ minLength: 12 });
    const u = await auth.register('a@x.com', 'twelve_chars', {});
    assert(u._id);
  });

  // maxLength
  await test('maxLength=10: 11 chars rejected', async () => {
    const auth = await newAuth({ minLength: 1, maxLength: 10 });
    await expectThrow(() => auth.register('a@x.com', 'eleven_char', {}), 'at most 10');
  });

  // requireUppercase
  await test('requireUppercase: lowercase only rejected', async () => {
    const auth = await newAuth({ minLength: 4, requireUppercase: true });
    await expectThrow(() => auth.register('a@x.com', 'abcdef', {}), 'uppercase');
  });
  await test('requireUppercase: with uppercase accepted', async () => {
    const auth = await newAuth({ minLength: 4, requireUppercase: true });
    const u = await auth.register('a@x.com', 'aBcdef', {});
    assert(u._id);
  });

  // requireLowercase
  await test('requireLowercase: uppercase only rejected', async () => {
    const auth = await newAuth({ minLength: 4, requireLowercase: true });
    await expectThrow(() => auth.register('a@x.com', 'ABCDEF', {}), 'lowercase');
  });

  // requireDigit
  await test('requireDigit: alpha only rejected', async () => {
    const auth = await newAuth({ minLength: 4, requireDigit: true });
    await expectThrow(() => auth.register('a@x.com', 'abcdef', {}), 'digit');
  });
  await test('requireDigit: with digit accepted', async () => {
    const auth = await newAuth({ minLength: 4, requireDigit: true });
    const u = await auth.register('a@x.com', 'abcd3f', {});
    assert(u._id);
  });

  // requireSymbol
  await test('requireSymbol: alphanum only rejected', async () => {
    const auth = await newAuth({ minLength: 4, requireSymbol: true });
    await expectThrow(() => auth.register('a@x.com', 'abc123', {}), 'symbol');
  });
  await test('requireSymbol: with symbol accepted', async () => {
    const auth = await newAuth({ minLength: 4, requireSymbol: true });
    const u = await auth.register('a@x.com', 'abc!23', {});
    assert(u._id);
  });

  // Combined enterprise policy
  await test('combined policy: NIST-like 12+upper+lower+digit', async () => {
    const auth = await newAuth({
      minLength: 12, requireUppercase: true, requireLowercase: true, requireDigit: true,
    });
    await expectThrow(() => auth.register('a@x.com', 'short', {}), 'at least 12');
    await expectThrow(() => auth.register('a@x.com', 'alllowercase!', {}), 'uppercase');
    await expectThrow(() => auth.register('a@x.com', 'ALLUPPERCASE!', {}), 'lowercase');
    await expectThrow(() => auth.register('a@x.com', 'NoDigitsHere!', {}), 'digit');
    const u = await auth.register('a@x.com', 'StrongPass123', {});
    assert(u._id, 'compliant password should pass');
  });

  // customValidator
  await test('customValidator: returning string rejects', async () => {
    const auth = await newAuth({
      minLength: 4,
      customValidator: (pw) => pw.includes('admin') ? 'cannot contain "admin"' : null,
    });
    await expectThrow(() => auth.register('a@x.com', 'admin123', {}), 'cannot contain "admin"');
  });
  await test('customValidator: returning null accepts', async () => {
    const auth = await newAuth({
      minLength: 4,
      customValidator: () => null,
    });
    const u = await auth.register('a@x.com', 'anything', {});
    assert(u._id);
  });

  // Policy applied in changePassword
  await test('changePassword: respects policy', async () => {
    const auth = await newAuth({ minLength: 10 });
    await expectThrow(() => auth.register('a@x.com', 'short', {}), 'at least 10');
    const u = await auth.register('a@x.com', 'longenoughpw', {});
    await expectThrow(
      () => auth.changePassword(u._id, 'longenoughpw', 'shortpw'),
      'at least 10'
    );
  });

  // Policy applied in resetPassword
  await test('resetPassword: respects policy', async () => {
    const auth = await newAuth({ minLength: 10 });
    const u = await auth.register('a@x.com', 'longenoughpw', {});
    await expectThrow(() => auth.resetPassword(u._id, 'shortpw'), 'at least 10');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
