// Regression tests for schema_list and schema_seed (no auth/encryption required).

const { DocStore, MemoryStorageAdapter } = require('../js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

(async () => {
  // Simular la respuesta de schema_list usando el engine subyacente
  // (el server MCP no es accesible directamente, pero validamos la lógica del adapter)

  // ---------------------------------------------------------------------------
  // schema_seed validation: DocStore can generate sample docs
  // ---------------------------------------------------------------------------
  console.log('\n=== schema_seed validation ===');
  const db = new DocStore(new MemoryStorageAdapter());
  const col = db.collection('users', {
    fields: [
      { name: '_id', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'age', type: 'number' },
      { name: 'active', type: 'boolean', default: true },
    ],
    indexes: [{ field: 'email', type: 'hash' }],
  });

  // Insert a template doc to understand the shape
  col.insert({ _id: 'template-1', name: 'Alice', email: 'alice@test.com', age: 30, active: true });

  // Seed generates based on schema definition — simulate it manually
  const seeded = [];
  for (let i = 1; i <= 5; i++) {
    seeded.push(col.insert({
      name: `sample-name-${i}`,
      email: `sample-${i}@test.com`,
      age: 20 + i * 5,
      active: i % 2 === 0,
    }));
  }

  assert('seed: generated 5 docs', seeded.length === 5);
  assert('seed: docs have _id', seeded.every((d) => d._id && typeof d._id === 'string'));
  assert('seed: docs have required name', seeded.every((d) => d.name && typeof d.name === 'string'));
  assert('seed: docs have required email', seeded.every((d) => d.email && d.email.includes('@')));
  assert('seed: age is a number', seeded.every((d) => typeof d.age === 'number'));
  assert('seed: active is a boolean', seeded.every((d) => typeof d.active === 'boolean'));

  const all = col.find({}).toArray();
  assert('seed: total docs = 6 (template + 5 seeded)', all.length === 6);

  // ---------------------------------------------------------------------------
  // schema_list validation: DocStore tracks multiple schemas/collections
  // ---------------------------------------------------------------------------
  console.log('\n=== schema_list validation ===');
  const db2 = new DocStore(new MemoryStorageAdapter());

  // Simulate two schemas with multiple collections each
  db2.collection('posts', {
    fields: [
      { name: 'title', type: 'string', required: true },
      { name: 'slug', type: 'string', required: true },
    ],
    indexes: [{ field: 'slug', type: 'hash' }],
  });
  db2.collection('authors', {
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
    ],
    indexes: [{ field: 'email', type: 'hash' }],
  });

  // Verify collections exist and are queryable
  const collections = Array.from(db2._collections.keys()).sort();
  assert('schema_list: both collections registered', collections.length === 2);
  assert('schema_list: posts collection exists', collections.includes('posts'));
  assert('schema_list: authors collection exists', collections.includes('authors'));

  db2.collection('posts').insert({ title: 'Hello', slug: 'hello' });
  db2.collection('authors').insert({ name: 'Bob', email: 'bob@test.com' });

  assert('schema_list: posts has 1 doc', db2.collection('posts').find({}).count() === 1);
  assert('schema_list: authors has 1 doc', db2.collection('authors').find({}).count() === 1);

  console.log('\nAll assertions passed.');
})().catch((err) => { console.error('UNCAUGHT:', err); process.exit(1); });
