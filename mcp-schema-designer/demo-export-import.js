const path = require('path');
const fs = require('fs');
const { DocStore, FileStorageAdapter } = require(path.join(__dirname, 'js-doc-store.js'));
const { exportSchema, importSchema } = require(path.join(__dirname, 'schema-portable.js'));

const db = new DocStore(new FileStorageAdapter(path.join(__dirname, 'schema-designer-data')));

console.log('=== Export/Import Demo ===\n');

// 1. Exportar blog_cms
console.log('1. Exportando blog_cms...');
const exportData = exportSchema(db, 'blog_cms');
const exportPath = path.join(__dirname, 'exports', 'blog_cms.export.json');
fs.mkdirSync(path.dirname(exportPath), { recursive: true });
fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2));
console.log('   Exportado a: ' + exportPath);
console.log('   Colecciones: ' + exportData.collections.map(c => c.name).join(', '));
console.log('   Documentos totales: ' + exportData.collections.reduce((s, c) => s + c.documentCount, 0));

// 2. Mostrar estructura del export
console.log('\n2. Estructura del export:');
console.log('   Schema: ' + exportData.name);
console.log('   Version: ' + exportData.version);
console.log('   ExportedAt: ' + exportData.exportedAt);
for (const col of exportData.collections) {
  console.log('   - ' + col.name + ': ' + col.documentCount + ' docs');
}

// 3. Crear una DB nueva (simulando produccion)
console.log('\n3. Simulando import en produccion...');
const prodDb = new DocStore(new FileStorageAdapter(path.join(__dirname, 'prod-data-clean')));
const result = importSchema(prodDb, exportData, { force: true });
console.log('   Importado: ' + result.imported);
console.log('   Colecciones: ' + result.collections.join(', '));
console.log('   Documentos: ' + result.documentCount);

// 4. Verificar que los datos estan en prod
console.log('\n4. Verificando datos en produccion...');
const prodPosts = prodDb.collection('posts');
const posts = prodPosts.find({}).toArray();
console.log('   Posts en prod: ' + posts.length);
for (const p of posts) {
  console.log('   - ' + p.title);
}

// 5. Verificar estructura del archivo exportado
console.log('\n5. Contenido del archivo exportado (primeros 1500 chars):');
const content = fs.readFileSync(exportPath, 'utf8');
console.log(content.substring(0, 1500));

console.log('\n=== Export/Import Demo completado ===');