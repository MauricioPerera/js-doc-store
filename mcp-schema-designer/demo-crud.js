const path = require("path");
const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

const db = new DocStore(new FileStorageAdapter(path.join(__dirname, "schema-designer-data")));

console.log("=== Schema Designer CRUD Demo ===\n");

// 1. schema_exists - Verificar que blog_cms existe
console.log("1. schema_exists: Verificando blog_cms...");
const schemas = db.collection("__schemas");
const blogSchema = schemas.findOne({ name: "blog_cms" });
console.log("   Existe:", !!blogSchema);
if (blogSchema) {
  console.log("   Descripcion:", blogSchema.description);
  console.log("   Colecciones:", blogSchema.collections.map(c => c.name).join(", "));
}

// 2. schema_query - Buscar posts publicados
console.log("\n2. schema_query: Posts publicados...");
const posts = db.collection("posts");
const publishedPosts = posts.find({ published: true }).toArray();
console.log("   Encontrados:", publishedPosts.length);
for (const p of publishedPosts) {
  console.log("   -", p.title, "(authorId:", p.authorId + ")");
}

// 3. schema_query - Buscar autor por email
console.log("\n3. schema_query: Buscar autor por email...");
const authors = db.collection("authors");
const mauricio = authors.findOne({ email: "mauricio@test.com" });
console.log("   Autor:", mauricio ? mauricio.name : "no encontrado");

// 4. schema_update - Actualizar titulo del post
console.log("\n4. schema_update: Cambiar titulo del post...");
const allPosts = posts.find({}).toArray();
if (allPosts.length > 0) {
  const targetId = allPosts[0]._id;
  posts.update({ _id: targetId }, { $set: { title: "Intro a js-doc-store (actualizado)" } });
  db.flush();
  const updated = posts.findOne({ _id: targetId });
  console.log("   Nuevo titulo:", updated.title);
}

// 5. schema_delete - Eliminar una categoria de prueba si existe
console.log("\n5. schema_delete: Limpiando datos de prueba...");
const categories = db.collection("categories");
const beforeCount = categories.find({}).count();
categories.remove({ slug: "test-category" });
db.flush();
const afterCount = categories.find({}).count();
console.log("   Categorias antes:", beforeCount, "- despues:", afterCount);

// 6. schema_query con filtros complejos
console.log("\n6. schema_query: Posts de Madrid (si city existiera)...");
// Nota: posts no tienen city, pero mostramos que el query engine funciona
const allAuthors = authors.find({}).toArray();
console.log("   Total autores:", allAuthors.length);

console.log("\n=== Demo CRUD completada ===");
