/**
 * Tests for Auth enhancements: email validation (#3) and password policy (#2)
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
  // ── EMAIL VALIDATION ──────────────────────────────────

  section('1. EMAIL VALIDATION (default: enabled)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test' });
    await auth.init();

    await assert('valid email passes', async () => {
      await auth.register('alice@test.com', 'password123');
    });

    await assertThrows('rejects non-email string', async () => {
      await auth.register('not-an-email', 'password123');
    }, 'Invalid email format');

    await assertThrows('rejects empty string', async () => {
      await auth.register('', 'password123');
    }, 'Email and password required');

    await assertThrows('rejects email without TLD', async () => {
      await auth.register('alice@test', 'password123');
    }, 'Invalid email format');

    await assertThrows('rejects spaces-only string', async () => {
      await auth.register('   ', 'password123');
    }, 'Invalid email format');

    await assert('trims and lowercases email', async () => {
      const user = await auth.register('  BOB@Test.COM  ', 'password123');
      return user.email === 'bob@test.com';
    });

    await assert('accepts minimal valid email', async () => {
      await auth.register('a@b.c', 'password123');
    });
  }

  section('2. EMAIL VALIDATION (disabled: validateEmail: false)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test', validateEmail: false });
    await auth.init();

    await assert('accepts non-email when validation disabled', async () => {
      await auth.register('username123', 'password123');
    });

    await assert('accepts arbitrary string', async () => {
      await auth.register('anything goes', 'password123');
    });
  }

  // ── PASSWORD POLICY ───────────────────────────────────

  section('3. PASSWORD POLICY (default: minLength 6)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test' });
    await auth.init();

    await assert('accepts 6+ chars (default)', async () => {
      await auth.register('default@test.com', 'abcdef');
    });

    await assertThrows('rejects < 6 chars', async () => {
      await auth.register('short@test.com', 'abc');
    }, 'Password must be at least 6 characters');
  }

  section('4. PASSWORD POLICY (custom: minLength 12)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test', passwordPolicy: { minLength: 12 } });
    await auth.init();

    await assertThrows('rejects < 12 chars', async () => {
      await auth.register('a@b.com', 'short123');
    }, 'Password must be at least 12 characters');

    await assert('accepts 12+ chars', async () => {
      await auth.register('a@b.com', 'longpassword12');
    });
  }

  section('5. PASSWORD POLICY (maxLength)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, { secret: 'test', passwordPolicy: { minLength: 6, maxLength: 20 } });
    await auth.init();

    await assert('accepts within max', async () => {
      await auth.register('a@b.com', 'validpassword');
    });

    await assertThrows('rejects over max', async () => {
      await auth.register('b@c.com', 'a'.repeat(21));
    }, 'Password must be at most 20 characters');
  }

  section('6. PASSWORD POLICY (requireUppercase, requireLowercase, requireDigit, requireSymbol)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, {
      secret: 'test',
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigit: true,
        requireSymbol: true,
      },
    });
    await auth.init();

    await assertThrows('rejects no uppercase', async () => {
      await auth.register('a@b.com', 'lowercase1!');
    }, 'uppercase');

    await assertThrows('rejects no lowercase', async () => {
      await auth.register('b@c.com', 'UPPERCASE1!');
    }, 'lowercase');

    await assertThrows('rejects no digit', async () => {
      await auth.register('c@d.com', 'NoDigits!!');
    }, 'digit');

    await assertThrows('rejects no symbol', async () => {
      await auth.register('d@e.com', 'NoSymbol1A');
    }, 'symbol');

    await assert('accepts all requirements met', async () => {
      await auth.register('e@f.com', 'Valid1Pass!');
    });
  }

  section('7. PASSWORD POLICY (customValidator)');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, {
      secret: 'test',
      passwordPolicy: {
        minLength: 6,
        customValidator: (pw) => {
          if (pw.includes('password')) return 'Password cannot contain the word "password"';
          return null;
        },
      },
    });
    await auth.init();

    await assertThrows('custom validator rejects', async () => {
      await auth.register('a@b.com', 'mypassword123');
    }, 'cannot contain the word');

    await assert('custom validator accepts', async () => {
      await auth.register('a@b.com', 'securekey123');
    });
  }

  section('8. PASSWORD POLICY applied to changePassword and resetPassword');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    const auth = new Auth(db, {
      secret: 'test',
      passwordPolicy: { minLength: 10, requireDigit: true },
    });
    await auth.init();

    const user = await auth.register('a@b.com', 'ValidPass1234');

    await assertThrows('changePassword validates policy', async () => {
      await auth.changePassword(user._id, 'ValidPass1234', 'short');
    }, 'at least 10');

    await assertThrows('changePassword requires digit', async () => {
      await auth.changePassword(user._id, 'ValidPass1234', 'longbutnumber');
    }, 'digit');

    await assert('changePassword accepts valid', async () => {
      await auth.changePassword(user._id, 'ValidPass1234', 'NewValid1234');
    });

    await assertThrows('resetPassword validates policy', async () => {
      await auth.resetPassword(user._id, 'short');
    }, 'at least 10');

    await assert('resetPassword accepts valid', async () => {
      await auth.resetPassword(user._id, 'ResetValid1234');
    });
  }

  section('9. BACKWARD COMPATIBILITY');

  {
    const db = new DocStore(new MemoryStorageAdapter());
    // No passwordPolicy, no validateEmail — should behave like before
    const auth = new Auth(db, { secret: 'test' });
    await auth.init();

    await assert('default policy allows 6-char passwords', async () => {
      await auth.register('compat@test.com', '123456');
    });

    await assertThrows('default policy rejects 5-char', async () => {
      await auth.register('compat2@test.com', '12345');
    }, 'at least 6');

    // Email validation is on by default
    await assertThrows('email validation on by default', async () => {
      await auth.register('not-email', '123456');
    }, 'Invalid email format');
  }

  // ── RESULTS ──

  console.log(`\n==================================================`);
  console.log(`PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`==================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
