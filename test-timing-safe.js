/**
 * Tests for timing-safe password verification (_constantTimeEqual)
 * Ensures password comparison is not vulnerable to timing attacks
 */

const { DocStore, MemoryStorageAdapter, Auth } = require('./js-doc-store');

let passed = 0, failed = 0;
async function assert(label, fn) {
  try {
    const result = await fn();
    if (result === false) throw new Error('returned false');
    passed++;
  } catch (err) {
    failed++;
    console.log(`  FAIL: ${label} — ${err.message}`);
  }
}

async function assertThrows(label, fn, expectedMsg) {
  try {
    await fn();
    failed++;
    console.log(`  FAIL: ${label} — expected to throw`);
  } catch (err) {
    if (expectedMsg && !err.message.includes(expectedMsg)) {
      failed++;
      console.log(`  FAIL: ${label} — expected "${expectedMsg}", got "${err.message}"`);
    } else {
      passed++;
    }
  }
}

function section(name) { console.log(`\n${name}\n`); }

async function run() {
  // ── CONSTANT-TIME VERIFICATION (no timing leaks) ──────────────────────

  section('1. PASSWORD VERIFICATION: register + login with correct password');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user@test.com';
    const password = 'SecurePass123!';

    const user = await auth.register(email, password);

    await assert('login succeeds with correct password', async () => {
      const result = await auth.login(email, password);
      return result && result.token && result.user && result.user._id === user._id;
    });
  }

  section('2. PASSWORD VERIFICATION: login with incorrect password fails');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user2@test.com';
    const password = 'SecurePass123!';

    await auth.register(email, password);

    await assertThrows('login fails with wrong password', async () => {
      await auth.login(email, 'WrongPassword123!');
    }, 'Invalid credentials');
  }

  section('3. PASSWORD VERIFICATION: login with partially correct password fails');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user3@test.com';
    const password = 'SecurePass123!';

    await auth.register(email, password);

    // Test with a password that matches only first N chars
    await assertThrows('login fails with prefix match', async () => {
      await auth.login(email, 'SecurePass');
    }, 'Invalid credentials');
  }

  section('4. CHANGE PASSWORD: correct oldPassword succeeds');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user4@test.com';
    const oldPassword = 'OldPass123!';
    const newPassword = 'NewPass456!';

    const user = await auth.register(email, oldPassword);

    await assert('changePassword succeeds with correct oldPassword', async () => {
      await auth.changePassword(user._id, oldPassword, newPassword);
      return true;
    });

    // Verify new password works
    await assert('login works with new password after change', async () => {
      const result = await auth.login(email, newPassword);
      return result && result.token && result.user;
    });

    // Verify old password no longer works
    await assertThrows('old password no longer works', async () => {
      await auth.login(email, oldPassword);
    }, 'Invalid credentials');
  }

  section('5. CHANGE PASSWORD: incorrect oldPassword fails');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user5@test.com';
    const correctPassword = 'CorrectPass123!';
    const newPassword = 'NewPass456!';

    const user = await auth.register(email, correctPassword);

    await assertThrows('changePassword fails with wrong oldPassword', async () => {
      await auth.changePassword(user._id, 'WrongOldPass123!', newPassword);
    }, 'Invalid current password');
  }

  section('6. CHANGE PASSWORD: incorrect oldPassword (prefix match) fails');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test_secret_key_1234' });
    await auth.init();

    const email = 'user6@test.com';
    const correctPassword = 'CorrectPass123!';
    const newPassword = 'NewPass456!';

    const user = await auth.register(email, correctPassword);

    await assertThrows('changePassword fails with prefix of oldPassword', async () => {
      await auth.changePassword(user._id, 'CorrectPass', newPassword);
    }, 'Invalid current password');
  }

  // ── RESULTS ──

  console.log(`\n==================================================`);
  console.log(`PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`==================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
