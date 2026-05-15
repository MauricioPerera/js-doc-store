// Regression test for issue #25:
// https://github.com/MauricioPerera/js-doc-store/issues/25
//
// flushDB was a no-op for every adapter: it called adapter.persist() but never
// db.flush(), so collections never wrote to the adapter. Inserts only lived in
// memory and vanished on process restart. The fix invokes db.flush() before
// adapter.persist(), matching the contract documented on EncryptedAdapter.persist.

const fs = require('fs');
const path = require('path');
const os = require('os');

const { DocStore, FileStorageAdapter, EncryptedAdapter } = require('./js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

// Replicates the server helper after the fix.
async function flushDB(db) {
  if (db && typeof db.flush === 'function') db.flush();
  const adapter = db._adapter || (db._collections && db._collections.values().next().value?._adapter);
  if (adapter && typeof adapter.persist === 'function') {
    await adapter.persist();
  }
}

// Also reproduce the OLD (buggy) helper for contrast.
async function flushDB_buggy(db) {
  const adapter = db._adapter || (db._collections && db._collections.values().next().value?._adapter);
  if (adapter && typeof adapter.persist === 'function') {
    await adapter.persist();
  }
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jds-issue25-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- Buggy flushDB: FileStorageAdapter never writes ---
{
  const dir = freshDir();
  const db = new DocStore(new FileStorageAdapter(dir));
  db.collection('todo').insert({ task: 'persist me' });
  flushDB_buggy(db);

  const dataFile = path.join(dir, 'todo.docs.json');
  assert('#25 buggy: no docs file written',
    !fs.existsSync(dataFile) || JSON.parse(fs.readFileSync(dataFile, 'utf8')).length === 0);

  rmDir(dir);
}

// --- Fixed flushDB: FileStorageAdapter writes synchronously, data survives reload ---
{
  const dir = freshDir();
  const db = new DocStore(new FileStorageAdapter(dir));
  db.collection('todo').insert({ task: 'persist me' });
  flushDB(db);

  const dataFile = path.join(dir, 'todo.docs.json');
  assert('#25 fixed: docs file exists', fs.existsSync(dataFile));

  // Simulate a process restart by opening a brand-new DocStore on the same dir
  const db2 = new DocStore(new FileStorageAdapter(dir));
  const docs = db2.collection('todo').find({}).toArray();
  assert('#25 fixed: reload finds 1 doc',          docs.length === 1);
  assert('#25 fixed: doc content survived restart', docs[0].task === 'persist me');

  rmDir(dir);
}

// --- Fixed flushDB with EncryptedAdapter: pending queue actually flushes ---
(async () => {
  const dir = freshDir();
  const inner = new FileStorageAdapter(dir);
  const adapter = await EncryptedAdapter.create(inner, 'test-password-1234567890');
  const db = new DocStore(adapter);

  db.collection('secret').insert({ value: 'sensitive' });
  await flushDB(db);

  const file = path.join(dir, 'secret.docs.json');
  assert('#25 encrypted: file exists after flush', fs.existsSync(file));

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert('#25 encrypted: raw bytes are encrypted', raw.__enc !== undefined);
  assert('#25 encrypted: ciphertext does not leak plaintext',
    !JSON.stringify(raw).includes('sensitive'));

  rmDir(dir);

  console.log('\nAll assertions passed.');
})().catch((err) => { console.error('UNCAUGHT:', err); process.exit(1); });
