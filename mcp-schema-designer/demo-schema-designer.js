const path = require("path");
const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

const db = new DocStore(new FileStorageAdapter(path.join(__dirname, "schema-designer-data")));

console.log("=== Schema Designer Demo ===\n");

// 1. Definir un schema de Blog CMS
const schemas = db.collection("__schemas");
console.log("1. Definiendo schema blog_cms...");
schemas.insert({
  name: "blog_cms",
  description: "Simple blog CMS with posts, authors and categories",
  collections: [
    {
      name: "authors",
      fields: [
        { name: "name", type: "string", required: true },
        { name: "email", type: "string", required: true, unique: true },
        { name: "bio", type: "string" }
      ],
      indexes: [{ field: "email", unique: true }]
    },
    {
      name: "categories",
      fields: [
        { name: "slug", type: "string", required: true, unique: true },
        { name: "title", type: "string", required: true }
      ],
      indexes: [{ field: "slug", unique: true }]
    },
    {
      name: "posts",
      fields: [
        { name: "title", type: "string", required: true },
        { name: "slug", type: "string", required: true, unique: true },
        { name: "content", type: "string", required: true },
        { name: "authorId", type: "ref", required: true, refCollection: "authors" },
        { name: "categoryIds", type: "array", required: false },
        { name: "published", type: "boolean", default: false },
        { name: "publishedAt", type: "date" },
        { name: "tags", type: "array" }
      ],
      indexes: [{ field: "slug", unique: true }]
    }
  ],
  createdAt: new Date().toISOString()
});
db.flush();
console.log("Schema blog_cms definido\n");

// 2. Instanciar (crear colecciones reales)
console.log("2. Instanciando schema blog_cms...");
const blogSchemas = schemas.findOne({ name: "blog_cms" });
for (const colDef of blogSchemas.collections) {
  const col = db.collection(colDef.name);
  col._ensureLoaded();
  if (colDef.indexes) {
    for (const idx of colDef.indexes) {
      try { col.createIndex(idx.field, { unique: !!idx.unique }); } catch(e) {}
    }
  }
  console.log("  Coleccion creada:", colDef.name);
}
db.flush();
console.log("Instanciacion completa\n");

// 3. Insertar datos validados
console.log("3. Insertando datos...");
const authors = db.collection("authors");
const categories = db.collection("categories");
const posts = db.collection("posts");

const mauricio = authors.insert({ name: "Mauricio", email: "mauricio@test.com", bio: "Dev" });
const tech = categories.insert({ slug: "tech", title: "Tecnologia" });
const post1 = posts.insert({
  title: "Intro a js-doc-store",
  slug: "intro-js-doc-store",
  content: "Es una base de datos en vanilla JS...",
  authorId: mauricio._id,
  categoryIds: [tech._id],
  published: true,
  publishedAt: new Date().toISOString(),
  tags: ["javascript", "database"]
});
db.flush();
console.log("Autor:", mauricio.name, "_id:", mauricio._id);
console.log("Categoria:", tech.title, "_id:", tech._id);
console.log("Post:", post1.title, "_id:", post1._id);

// 4. Listar schemas
console.log("\n4. Schemas definidos:");
const all = schemas.find({}).toArray();
for (const s of all) {
  console.log(" -", s.name, "(", s.description, ") - colecciones:", s.collections.map(c => c.name).join(", "));
}

console.log("\n=== Demo completada ===");
