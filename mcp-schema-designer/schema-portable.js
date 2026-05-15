const path = require("path");
const fs = require("fs");
const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

function exportSchema(db, schemaName, options = {}) {
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: schemaName });
  if (!schema) throw new Error(`Schema ${schemaName} not found`);

  const exportData = {
    name: schema.name,
    description: schema.description,
    version: options.version || "1.0.0",
    exportedAt: new Date().toISOString(),
    collections: []
  };

  for (const colDef of schema.collections) {
    const colName = options.prefix ? options.prefix + colDef.name : colDef.name;
    const col = db.collection(colName);
    const docs = col.find({}).toArray();
    exportData.collections.push({
      name: colDef.name,
      definition: colDef,
      documents: docs,
      documentCount: docs.length
    });
  }

  return exportData;
}

function importSchema(db, exportData, options = {}) {
  const schemas = db.collection("__schemas");
  const existing = schemas.findOne({ name: exportData.name });
  if (existing) {
    if (!options.force) {
      throw new Error(`Schema ${exportData.name} already exists. Use force=true to overwrite.`);
    }
    schemas.update({ name: exportData.name }, { $set: { collections: exportData.collections.map(c => c.definition), description: exportData.description, updatedAt: new Date().toISOString() } });
  } else {
    schemas.insert({ name: exportData.name, description: exportData.description, collections: exportData.collections.map(c => c.definition), createdAt: new Date().toISOString() });
  }

  for (const colData of exportData.collections) {
    const colName = options.prefix ? options.prefix + colData.name : colData.name;
    const col = db.collection(colName);
    col._ensureLoaded();

    if (colData.definition.indexes) {
      for (const idx of colData.definition.indexes) {
        try { col.createIndex(idx.field, { unique: !!idx.unique }); } catch(e) {}
      }
    }
    for (const field of colData.definition.fields) {
      if (field.index) {
        try { col.createIndex(field.name, { unique: !!field.unique }); } catch(e) {}
      }
    }

    if (!options.skipData && colData.documents) {
      for (const doc of colData.documents) {
        col.insert(doc);
      }
    }
  }

  db.flush();
  return { imported: exportData.name, collections: exportData.collections.map(c => c.name), documentCount: exportData.collections.reduce((sum, c) => sum + c.documentCount, 0) };
}

module.exports = { exportSchema, importSchema };
