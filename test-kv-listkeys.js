// Test suite for CloudflareKVAdapter.listKeys() + preloadAll() (issue #4)
// Run: node test-kv-listkeys.js
//
// Uses an in-memory mock of KVNamespace that mirrors Cloudflare's API
// (list/get/put with cursor pagination).

const { CloudflareKVAdapter, DocStore } = require('./js-doc-store');

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const assertEq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg || 'mismatch'}\n      got:      ${JSON.stringify(a)}\n      expected: ${JSON.stringify(b)}`);
  }
};

// ── Mock KVNamespace ──────────────────────────────────────────
class MockKV {
  constructor() { this._store = new Map(); this._listLimit = 1000; }
  async get(key, type) {
    const v = this._store.get(key);
    if (v == null) return null;
    return type === 'json' ? JSON.parse(v) : v;
  }
  async put(key, val) { this._store.set(key, typeof val === 'string' ? val : JSON.stringify(val)); }
  async delete(key) { this._store.delete(key); }
  async list({ prefix = '', cursor } = {}) {
    const all = [...this._store.keys()].filter(k => k.startsWith(prefix)).sort();
    const start = cursor ? parseInt(cursor, 10) : 0;
    const slice = all.slice(start, start + this._listLimit);
    const next = start + this._listLimit;
    if (next >= all.length) return { keys: slice.map(name => ({ name })), list_complete: true };
    return { keys: slice.map(name => ({ name })), list_complete: false, cursor: String(next) };
  }
}

(async () => {
  console.log('CloudflareKVAdapter.listKeys() + preloadAll() tests\n');

  await test('listKeys empty', async () => {
    const kv = new MockKV();
    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const keys = await adapter.listKeys();
    assertEq(keys, []);
  });

  await test('listKeys with prefix strips prefix', async () => {
    const kv = new MockKV();
    await kv.put('app/users.docs.json', '{}');
    await kv.put('app/users.meta.json', '{}');
    await kv.put('app/sessions.docs.json', '{}');
    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const keys = await adapter.listKeys();
    assertEq(keys.sort(), ['sessions.docs.json', 'users.docs.json', 'users.meta.json']);
  });

  await test('listKeys ignores siblings outside prefix', async () => {
    const kv = new MockKV();
    await kv.put('app1/users.docs.json', '{}');
    await kv.put('app2/users.docs.json', '{}');
    const adapter = new CloudflareKVAdapter(kv, 'app1/');
    const keys = await adapter.listKeys();
    assertEq(keys, ['users.docs.json']);
  });

  await test('listKeys with no prefix returns all', async () => {
    const kv = new MockKV();
    await kv.put('a', '1');
    await kv.put('b', '2');
    const adapter = new CloudflareKVAdapter(kv);
    const keys = await adapter.listKeys();
    assertEq(keys.sort(), ['a', 'b']);
  });

  await test('listKeys paginates beyond 1000 entries', async () => {
    const kv = new MockKV();
    kv._listLimit = 100;  // smaller for fast test
    for (let i = 0; i < 250; i++) await kv.put(`app/k${String(i).padStart(3, '0')}`, '{}');
    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const keys = await adapter.listKeys();
    assert(keys.length === 250, `expected 250 keys, got ${keys.length}`);
    assert(keys.includes('k000') && keys.includes('k249'), 'first/last entries present');
  });

  await test('preloadAll discovers + loads all keys', async () => {
    const kv = new MockKV();
    await kv.put('app/foo.docs.json', JSON.stringify([{ _id: '1', name: 'A' }]));
    await kv.put('app/foo.meta.json', JSON.stringify({ indexes: [] }));
    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const loaded = await adapter.preloadAll();
    assertEq(loaded.sort(), ['foo.docs.json', 'foo.meta.json']);

    // Now sync reads should work
    const docs = adapter.readJson('foo.docs.json');
    assertEq(docs, [{ _id: '1', name: 'A' }]);
  });

  await test('preloadAll on empty namespace returns empty array', async () => {
    const kv = new MockKV();
    const adapter = new CloudflareKVAdapter(kv, 'empty/');
    const loaded = await adapter.preloadAll();
    assertEq(loaded, []);
  });

  // End-to-end: DocStore + preloadAll without knowing collection names
  await test('DocStore can be opened via preloadAll without prior knowledge', async () => {
    const kv = new MockKV();

    // Session 1: write some data
    {
      const a = new CloudflareKVAdapter(kv, 'tenant/');
      const db = new DocStore(a);
      db.collection('users').insert({ name: 'Alice' });
      db.collection('orders').insert({ price: 100 });
      db.flush();
      await a.persist();
    }

    // Session 2: open WITHOUT knowing collection names
    {
      const a = new CloudflareKVAdapter(kv, 'tenant/');
      const loadedFiles = await a.preloadAll();
      assert(loadedFiles.length >= 4, `expected >= 4 files, got ${loadedFiles.length}: ${loadedFiles}`);
      const db = new DocStore(a);
      const users = db.collection('users').find({}).toArray();
      const orders = db.collection('orders').find({}).toArray();
      assertEq(users.length, 1);
      assertEq(orders.length, 1);
      assert(users[0].name === 'Alice');
      assert(orders[0].price === 100);
    }
  });

  await test('multi-tenant isolation via prefix', async () => {
    const kv = new MockKV();
    const tenantA = new CloudflareKVAdapter(kv, 'tenantA/');
    const tenantB = new CloudflareKVAdapter(kv, 'tenantB/');

    const dbA = new DocStore(tenantA);
    const dbB = new DocStore(tenantB);

    dbA.collection('users').insert({ name: 'Alice (A)' });
    dbB.collection('users').insert({ name: 'Bob (B)' });
    dbA.flush(); dbB.flush();
    await tenantA.persist();
    await tenantB.persist();

    // Each tenant only sees their own keys
    const aKeys = await tenantA.listKeys();
    const bKeys = await tenantB.listKeys();
    assert(aKeys.every(k => !k.includes('tenantA') && !k.includes('tenantB')), 'prefix stripped');
    assertEq(aKeys.sort(), bKeys.sort(), 'both tenants have same collection names (independently)');

    // Re-load tenant A and confirm only A data
    const tenantA2 = new CloudflareKVAdapter(kv, 'tenantA/');
    await tenantA2.preloadAll();
    const dbA2 = new DocStore(tenantA2);
    const users = dbA2.collection('users').find({}).toArray();
    assertEq(users.length, 1);
    assert(users[0].name === 'Alice (A)', `tenant A bleed: got ${users[0].name}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
