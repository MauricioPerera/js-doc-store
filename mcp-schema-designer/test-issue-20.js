// Regression test for issue #20:
// https://github.com/MauricioPerera/js-doc-store/issues/20
//
// schema_delete reported an inflated deletedCount because the server handler
// called Collection.remove (single) while using find(filter).count() as the
// reported number. This test reproduces both the buggy and the fixed flow
// against the engine to lock in the correct behavior.

const { DocStore, MemoryStorageAdapter } = require('./js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function seed(col) {
  for (let i = 1; i <= 6; i++) {
    col.insert({ title: `sample-title-${i}`, status: `sample-status-${i}` });
  }
  col.insert({ title: 'Real post', status: 'published' });
}

const filter = { title: { $regex: 'sample-title' } };

// --- Buggy server flow: count via find().count(), delete via remove() ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seed(col);

  const reported = col.find(filter).count();
  col.remove(filter);
  const actuallyRemaining = col.find(filter).count();
  const actuallyDeleted = reported - actuallyRemaining;

  assert('buggy flow: reported says 6', reported === 6);
  assert('buggy flow: only 1 was deleted', actuallyDeleted === 1);
  assert('buggy flow: 5 sample docs still there', actuallyRemaining === 5);
}

// --- Fixed server flow: use removeMany return value ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seed(col);

  const deletedCount = col.removeMany(filter);
  const remaining = col.find(filter).count();

  assert('fixed flow: removeMany returns real count (6)', deletedCount === 6);
  assert('fixed flow: no sample docs remain', remaining === 0);
  assert('fixed flow: real post untouched', col.find({ status: 'published' }).count() === 1);
}

console.log('\nAll assertions passed.');
