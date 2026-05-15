// Regression test for PR #12:
// https://github.com/MauricioPerera/js-doc-store/pull/12
//
// 1. EncryptedAdapter.persist() must delegate to inner.persist()
// 2. EncryptedAdapter must provide clearCache() to purge plaintext from heap

const fs = require('fs');
const path = require('path');
const os = require('os');

const { DocStore, FileStorageAdapter, EncryptedAdapter } = require('../js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jds-issue12-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Mock inner adapter that tracks persist() calls
function createMockAdapter(dir) {
  const inner = new FileStorageAdapter(dir);
  let persistCalled = false;
  const mock = {
    dir,
    readJson: (...args) => inner.readJson(...args),
    writeJson: (...args) => inner.writeJson(...args),
    readBin: (...args) => inner.readBin(...args),
    writeBin: (...args) => inner.writeBin(...args),
    delete: (...args) => inner.delete(...args),
    preload: async (...args) => { if (typeof inner.preload === 'function') await inner.preload(...args); },
    preloadAll: async (...args) => { if (typeof inner.preloadAll === 'function') await inner.preloadAll(...args); },
    persist: async () => { persistCalled = true; if (typeof inner.persist === 'function') await inner.persist(); },
    getPersistCalled: () => persistCalled,
  };
  return mock;
}

(async () => {

  // ---------------------------------------------------------------------------
  // Fix 1: persist() delegates to inner.persist()
  // ---------------------------------------------------------------------------
  {
    const dir = freshDir();
    const mock = createMockAdapter(dir);
    const adapter = await EncryptedAdapter.create(mock, 'test-password-12345678');
    const db = new DocStore(adapter);

    db.collection('secrets').insert({ value: 'sensitive' });
    db.flush();
    await adapter.persist();

    assert('#12 persist: inner.persist() was called', mock.getPersistCalled());

    // Verify data was actually written to disk through the mock
    const dataFile = path.join(dir, 'secrets.docs.json');
    assert('#12 persist: encrypted file exists on disk', fs.existsSync(dataFile));
    const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert('#12 persist: file contains __enc envelope', raw.__enc !== undefined);

    rmDir(dir);
  }

  // ---------------------------------------------------------------------------
  // Fix 2: clearCache() purges plaintext from heap
  // ---------------------------------------------------------------------------
  {
    const dir = freshDir();
    const inner = new FileStorageAdapter(dir);
    const adapter = await EncryptedAdapter.create(inner, 'another-password-87654321');
    const db = new DocStore(adapter);

    db.collection('secrets').insert({ value: 'top-secret' });
    db.flush();
    await adapter.persist();

    // At this point _cache should hold plaintext
    assert('#12 cache: _cache exists before clear', adapter._cache !== undefined);
    assert('#12 cache: _cache has plaintext before clear', adapter._cache.has('secrets.docs.json'));
    const cachedBefore = adapter._cache.get('secrets.docs.json');
    assert('#12 cache: cached value is the plaintext object',
      Array.isArray(cachedBefore) && cachedBefore.length === 1 && cachedBefore[0].value === 'top-secret');

    // Clear cache
    adapter.clearCache();
    assert('#12 clearCache: _cache is empty after clear', adapter._cache.size === 0);

    // Verify readJson now fails because cache is gone (would need preload)
    let threw = false;
    try {
      adapter.readJson('secrets.docs.json');
    } catch (err) {
      threw = true;
      assert('#12 clearCache: readJson throws after clear', err.message.includes('no decryption cache available'));
    }
    assert('#12 clearCache: readJson did throw', threw);

    // Verify preload restores read capability
    await adapter.preload(['secrets.docs.json']);
    const restored = adapter.readJson('secrets.docs.json');
    assert('#12 clearCache: preload restores decrypted data',
      Array.isArray(restored) && restored.length === 1 && restored[0].value === 'top-secret');

    rmDir(dir);
  }

  console.log('\nAll assertions passed.');

})().catch((err) => { console.error('UNCAUGHT:', err); process.exit(1); });
