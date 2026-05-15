// Regression test for issues #23 and #24:
// https://github.com/MauricioPerera/js-doc-store/issues/23  (secure_delete)
// https://github.com/MauricioPerera/js-doc-store/issues/24  (schema_update)
//
// Same root cause as #20: the server called the single-doc engine method
// (remove / update) instead of the multi-doc one (removeMany / updateMany).
// This pins the corrected flow against the engine and the failure modes of
// the original implementation.

const { DocStore, MemoryStorageAdapter } = require('./js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function seedDrafts(col, n) {
  for (let i = 0; i < n; i++) {
    col.insert({ title: `post-${i}`, status: 'draft', views: 0 });
  }
}

// =============================================================================
// #23  secure_delete: removeMany returns the true count and clears all matches
// =============================================================================

// --- Buggy flow (col.remove): only 1 deleted, but ids list says all of them ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  const ids = col.find({ status: 'draft' }).toArray().map(d => d._id);
  col.remove({ status: 'draft' });
  const remaining = col.find({ status: 'draft' }).count();

  assert('#23 buggy: ids list has 3', ids.length === 3);
  assert('#23 buggy: only 1 actually deleted', remaining === 2);
}

// --- Fixed flow (col.removeMany): deletedCount === ids.length, none remain ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  const ids = col.find({ status: 'draft' }).toArray().map(d => d._id);
  const deletedCount = col.removeMany({ status: 'draft' });
  const remaining = col.find({ status: 'draft' }).count();

  assert('#23 fixed: deletedCount=3',     deletedCount === 3);
  assert('#23 fixed: ids.length matches', deletedCount === ids.length);
  assert('#23 fixed: none remain',        remaining === 0);
}

// =============================================================================
// #24  schema_update: updateMany returns truth, re-fetch by _id returns the
//                   actually-updated docs (not whatever the filter matches
//                   after the update mutated the field)
// =============================================================================

// --- Buggy flow A: update changes a filter field. find(filter) after update
//                   returns 0 unrelated docs. updatedCount reported = 0 even
//                   though 1 doc was actually updated. ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  col.update({ status: 'draft' }, { $set: { status: 'published' } });
  const reFind = col.find({ status: 'draft' }).toArray();
  const reallyPublished = col.find({ status: 'published' }).count();

  assert('#24 buggy A: reFind ignores updated doc', reFind.length === 2);
  assert('#24 buggy A: only 1 doc was updated',     reallyPublished === 1);
}

// --- Buggy flow B: update does NOT change filter field. find(filter) after
//                   update returns ALL matches (including the unchanged ones).
//                   updatedCount inflates and docs list includes the wrong ones. ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  col.update({ status: 'draft' }, { $inc: { views: 1 } });
  const reFind = col.find({ status: 'draft' }).toArray();
  const trulyIncremented = reFind.filter(d => d.views === 1);
  const stillZero        = reFind.filter(d => d.views === 0);

  assert('#24 buggy B: 1 doc has views=1', trulyIncremented.length === 1);
  assert('#24 buggy B: 2 docs untouched',   stillZero.length === 2);
}

// --- Fixed flow A: capture ids pre-update, use updateMany, re-fetch by _id ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  const ids = col.find({ status: 'draft' }).toArray().map(d => d._id);
  const updatedCount = col.updateMany({ status: 'draft' }, { $set: { status: 'published' } });
  const docs = col.find({ _id: { $in: ids } }).toArray();

  assert('#24 fixed A: updatedCount=3',                 updatedCount === 3);
  assert('#24 fixed A: re-fetch returns 3 docs',        docs.length === 3);
  assert('#24 fixed A: all 3 docs now published',       docs.every(d => d.status === 'published'));
}

// --- Fixed flow B: $inc update ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seedDrafts(col, 3);

  const ids = col.find({ status: 'draft' }).toArray().map(d => d._id);
  const updatedCount = col.updateMany({ status: 'draft' }, { $inc: { views: 5 } });
  const docs = col.find({ _id: { $in: ids } }).toArray();

  assert('#24 fixed B: updatedCount=3',           updatedCount === 3);
  assert('#24 fixed B: re-fetch returns 3 docs',  docs.length === 3);
  assert('#24 fixed B: every doc has views=5',    docs.every(d => d.views === 5));
}

console.log('\nAll assertions passed.');
