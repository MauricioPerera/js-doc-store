/**
 * Tests for CloudflareKVAdapter.listKeys() and preloadAll() (#4)
 * Uses a mock KV namespace that simulates Cloudflare Workers KV API.
 */

const { CloudflareKVAdapter } = require('./js-doc-store');

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

function section(name) { console.log(`\n${name}\n`); }

/**
 * Mock KV namespace that simulates Cloudflare Workers KV API.
 * Supports: get, put, delete, list (with cursor pagination).
 */
class MockKV {
  constructor() { this._store = new Map(); }

  async get(key, type) {
    const val = this._store.get(key);
    if (val === undefined) return null;
    if (type === 'json') return JSON.parse(val);
    return val;
  }

  async put(key, value) {
    this._store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }

  async delete(key) {
    this._store.delete(key);
  }

  async list({ prefix = '', cursor } = {}) {
    // Collect all matching keys
    const allKeys = [];
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        allKeys.push({ name: key });
      }
    }
    allKeys.sort((a, b) => a.name.localeCompare(b.name));

    // Simulate pagination with page size of 3 (to test cursor logic)
    const PAGE_SIZE = 3;
    const startIdx = cursor ? parseInt(cursor, 10) : 0;
    const slice = allKeys.slice(startIdx, startIdx + PAGE_SIZE);
    const nextIdx = startIdx + PAGE_SIZE;
    const complete = nextIdx >= allKeys.length;

    return {
      keys: slice,
      list_complete: complete,
      cursor: complete ? undefined : String(nextIdx),
    };
  }
}

async function run() {
  section('1. listKeys — empty namespace');
  {
    const kv = new MockKV();
    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const keys = await adapter.listKeys();
    await assert('returns empty array', () => keys.length === 0);
  }

  section('2. listKeys — with keys');
  {
    const kv = new MockKV();
    await kv.put('app/users.docs.json', '[]');
    await kv.put('app/users.meta.json', '{}');
    await kv.put('app/orders.docs.json', '[]');
    await kv.put('other/unrelated.json', '{}');

    const adapter = new CloudflareKVAdapter(kv, 'app/');
    const keys = await adapter.listKeys();

    await assert('returns 3 keys (filters by prefix)', () => keys.length === 3);
    await assert('strips prefix from key names', () =>
      keys.includes('users.docs.json') &&
      keys.includes('users.meta.json') &&
      keys.includes('orders.docs.json')
    );
    await assert('excludes keys from other prefix', () => !keys.includes('unrelated.json'));
  }

  section('3. listKeys — pagination (>3 keys with page size 3)');
  {
    const kv = new MockKV();
    for (let i = 0; i < 10; i++) {
      await kv.put(`data/file${i}.json`, JSON.stringify({ i }));
    }

    const adapter = new CloudflareKVAdapter(kv, 'data/');
    const keys = await adapter.listKeys();

    await assert('returns all 10 keys across pages', () => keys.length === 10);
    await assert('all keys present', () => {
      for (let i = 0; i < 10; i++) {
        if (!keys.includes(`file${i}.json`)) return false;
      }
      return true;
    });
  }

  section('4. listKeys — no prefix');
  {
    const kv = new MockKV();
    await kv.put('a.json', '1');
    await kv.put('b.json', '2');

    const adapter = new CloudflareKVAdapter(kv, '');
    const keys = await adapter.listKeys();
    await assert('returns all keys when prefix is empty', () => keys.length === 2);
  }

  section('5. preloadAll');
  {
    const kv = new MockKV();
    await kv.put('ns/users.docs.json', JSON.stringify([{ _id: '1', name: 'Alice' }]));
    await kv.put('ns/users.meta.json', JSON.stringify({ indexes: [] }));
    await kv.put('ns/orders.docs.json', JSON.stringify([{ _id: '2', product: 'X' }]));

    const adapter = new CloudflareKVAdapter(kv, 'ns/');

    // Before preloadAll, cache is empty
    await assert('cache empty before preloadAll', () => adapter.readJson('users.docs.json') === null);

    await adapter.preloadAll();

    await assert('preloadAll loads users.docs.json', () => {
      const data = adapter.readJson('users.docs.json');
      return Array.isArray(data) && data.length === 1 && data[0].name === 'Alice';
    });

    await assert('preloadAll loads users.meta.json', () => {
      const data = adapter.readJson('users.meta.json');
      return data && Array.isArray(data.indexes);
    });

    await assert('preloadAll loads orders.docs.json', () => {
      const data = adapter.readJson('orders.docs.json');
      return Array.isArray(data) && data.length === 1;
    });
  }

  section('6. preloadAll with pagination');
  {
    const kv = new MockKV();
    // Insert 8 files (will require 3 pages with page size 3)
    for (let i = 0; i < 8; i++) {
      await kv.put(`p/f${i}.json`, JSON.stringify({ idx: i }));
    }

    const adapter = new CloudflareKVAdapter(kv, 'p/');
    await adapter.preloadAll();

    await assert('all 8 files loaded', () => {
      for (let i = 0; i < 8; i++) {
        const data = adapter.readJson(`f${i}.json`);
        if (!data || data.idx !== i) return false;
      }
      return true;
    });
  }

  section('7. preloadAll on empty namespace');
  {
    const kv = new MockKV();
    const adapter = new CloudflareKVAdapter(kv, 'empty/');
    await adapter.preloadAll(); // should not throw
    await assert('no error on empty namespace', () => true);
  }

  section('8. write + persist + listKeys round-trip');
  {
    const kv = new MockKV();
    const adapter = new CloudflareKVAdapter(kv, 'rt/');

    // Write via adapter
    adapter.writeJson('new.json', { hello: 'world' });
    await adapter.persist();

    // New adapter should see it via listKeys
    const adapter2 = new CloudflareKVAdapter(kv, 'rt/');
    const keys = await adapter2.listKeys();
    await assert('persisted key visible in listKeys', () => keys.includes('new.json'));

    await adapter2.preloadAll();
    await assert('preloadAll loads persisted data', () => {
      const data = adapter2.readJson('new.json');
      return data && data.hello === 'world';
    });
  }

  section('9. deleteFromKV + listKeys');
  {
    const kv = new MockKV();
    await kv.put('d/a.json', '"1"');
    await kv.put('d/b.json', '"2"');

    const adapter = new CloudflareKVAdapter(kv, 'd/');
    await adapter.deleteFromKV('a.json');

    const keys = await adapter.listKeys();
    await assert('deleted key not in listKeys', () =>
      keys.length === 1 && keys[0] === 'b.json'
    );
  }

  // ── RESULTS ──
  console.log(`\n==================================================`);
  console.log(`PASSED: ${passed}  FAILED: ${failed}`);
  console.log(`==================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(console.error);
