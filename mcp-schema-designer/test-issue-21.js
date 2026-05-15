// Regression test for issue #21:
// https://github.com/MauricioPerera/js-doc-store/issues/21
//
// schema_aggregate group stage silently dropped accumulator results when given
// an unsupported shape (e.g. { op: "sum", field: "views" }). The engine only
// recognizes MongoDB-style keys ($sum, $avg, $count, $min, $max, $push,
// $first, $last). This test pins both correct behavior with the supported
// shape and the validation we added so unsupported shapes raise immediately
// instead of returning empty results.

const { DocStore, MemoryStorageAdapter } = require('./js-doc-store.js');
const { validateAccumulators } = require('./schema-aggregate-utils.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function seed(col) {
  col.insert({ author: 'ada',   views: 100, likes: 10 });
  col.insert({ author: 'ada',   views: 50,  likes: 5 });
  col.insert({ author: 'alan',  views: 200, likes: 20 });
  col.insert({ author: 'grace', views: 80,  likes: 8 });
  col.insert({ author: 'grace', views: 70,  likes: 7 });
  col.insert({ author: 'grace', views: 30,  likes: 3 });
}

// --- Supported MongoDB-style accumulators produce real numbers ---
{
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('post');
  seed(col);

  const results = col.aggregate()
    .group('author', {
      totalViews: { $sum: 'views' },
      avgViews:   { $avg: 'views' },
      totalLikes: { $sum: 'likes' },
      count:      { $count: 1 },
      maxViews:   { $max: 'views' },
    })
    .sort({ totalViews: -1 })
    .toArray();

  assert('3 groups', results.length === 3);

  const ada = results.find(r => r._id === 'ada');
  assert('ada totalViews=150', ada.totalViews === 150);
  assert('ada avgViews=75',    ada.avgViews === 75);
  assert('ada totalLikes=15',  ada.totalLikes === 15);
  assert('ada count=2',        ada.count === 2);
  assert('ada maxViews=100',   ada.maxViews === 100);

  const grace = results.find(r => r._id === 'grace');
  assert('grace count=3', grace.count === 3);
  assert('grace totalViews=180', grace.totalViews === 180);
}

// --- Validation: unsupported shape ({op, field}) throws a descriptive error ---
{
  try {
    validateAccumulators({ totalViews: { op: 'sum', field: 'views' } });
    console.error('FAIL: validator should have thrown on {op, field} shape');
    process.exit(1);
  } catch (err) {
    assert('validator rejects {op, field}',
      /accumulator/i.test(err.message) && /\$sum/.test(err.message));
  }
}

// --- Validation: empty object throws ---
{
  try {
    validateAccumulators({ totalViews: {} });
    console.error('FAIL: validator should have thrown on empty accumulator');
    process.exit(1);
  } catch (err) {
    assert('validator rejects empty accumulator', /no operator/i.test(err.message));
  }
}

// --- Validation: known shape passes through unchanged ---
{
  const accs = { totalViews: { $sum: 'views' }, count: { $count: 1 } };
  const out = validateAccumulators(accs);
  assert('validator accepts $sum',   out.totalViews.$sum === 'views');
  assert('validator accepts $count', out.count.$count === 1);
}

console.log('\nAll assertions passed.');
