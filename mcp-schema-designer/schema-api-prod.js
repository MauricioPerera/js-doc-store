const http = require("http");
const url = require("url");
const path = require("path");
const fs = require("fs");

const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const { importSchema } = require(path.join(__dirname, "schema-portable.js"));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "prod-data");
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(__dirname, "exports");
const SEED_ON_START = process.env.SEED_ON_START === "true";

const db = new DocStore(new FileStorageAdapter(DATA_DIR));

// Auto-import exported schemas on startup
function autoImport() {
  if (!fs.existsSync(EXPORT_DIR)) {
    console.log("No exports directory found. Starting with empty database.");
    return;
  }
  const files = fs.readdirSync(EXPORT_DIR).filter(f => f.endsWith(".export.json"));
  if (files.length === 0) {
    console.log("No export files found. Starting with empty database.");
    return;
  }
  console.log(`Found ${files.length} export file(s): ${files.join(", ")}`);
  for (const file of files) {
    const filePath = path.join(EXPORT_DIR, file);
    const exportData = JSON.parse(fs.readFileSync(filePath, "utf8"));
    try {
      const result = importSchema(db, exportData, { force: true });
      console.log(`  Imported: ${result.imported} (${result.documentCount} docs)`);
    } catch (err) {
      console.error(`  Failed to import ${file}: ${err.message}`);
    }
  }
}

autoImport();

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data, null, 2));
}

function getSchema(schemaName) {
  const schemas = db.collection("__schemas");
  return schemas.findOne({ name: schemaName });
}

function validateDoc(schema, collectionName, doc, isUpdate = false) {
  const colDef = schema.collections.find(c => c.name === collectionName);
  if (!colDef) throw new Error(`Collection ${collectionName} not found`);
  const errors = [];
  for (const field of colDef.fields) {
    if (field.required && !isUpdate && (doc[field.name] === undefined || doc[field.name] === null)) {
      errors.push(`Missing required field: ${field.name}`);
    }
  }
  return errors;
}

// Issue #27: validate ref fields point to existing documents
function validateRefs(schema, collectionName, doc) {
  const colDef = schema.collections.find(c => c.name === collectionName);
  if (!colDef) return [];
  const errors = [];
  for (const field of colDef.fields) {
    if (field.type === "ref" && field.refCollection && doc[field.name] !== undefined && doc[field.name] !== null) {
      const refCol = db.collection(field.refCollection);
      if (!refCol.findById(doc[field.name])) {
        errors.push(`Reference not found: ${field.name} "${doc[field.name]}" does not exist in ${field.refCollection}`);
      }
    }
  }
  return errors;
}

// Issue #28: wrap plain updates in $set, preserve MongoDB operators
function wrapUpdate(body) {
  const hasOperator = Object.keys(body).some(k => k.startsWith("$"));
  return hasOperator ? body : { $set: body };
}

function parseFilter(query) {
  const filter = {};
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith("__")) continue;
    if (Array.isArray(val)) { filter[key] = { $in: val }; continue; }
    if (typeof val !== "string") { filter[key] = val; continue; }
    if (val.startsWith("{") && val.endsWith("}")) {
      try { filter[key] = JSON.parse(val); continue; } catch(e) {}
    }
    if (val === "true") { filter[key] = true; continue; }
    if (val === "false") { filter[key] = false; continue; }
    if (!isNaN(val) && val.trim() !== "") { filter[key] = Number(val); continue; }
    filter[key] = val;
  }
  return filter;
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  try { return JSON.parse(body); } catch { return {}; }
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  if (req.method === "OPTIONS") {
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" });
    return res.end();
  }

  try {
    // Health check
    if (pathname === "/health") {
      return send(res, 200, { status: "ok", api: "js-doc-store-headless", version: "2.0.0" });
    }

    // List schemas
    if (pathname === "/api") {
      const schemas = db.collection("__schemas");
      const all = schemas.find({}).toArray();
      return send(res, 200, { api: "js-doc-store-headless", version: "2.0.0", schemas: all.map(s => ({ name: s.name, description: s.description, collections: s.collections.map(c => c.name) })) });
    }

    const m = pathname.match(/^\/api\/([^\/]+)(?:\/([^\/]+))?(?:\/([^\/]+))?$/);
    if (!m) return send(res, 404, { error: "Not found. Use /api/:schema/:collection or /api" });

    const [, schemaName, collectionName, docId] = m;
    const schema = getSchema(schemaName);
    if (!schema) return send(res, 404, { error: `Schema ${schemaName} not found` });

    if (!collectionName) {
      return send(res, 200, { schema: schema.name, description: schema.description, collections: schema.collections.map(c => ({ name: c.name, fields: c.fields, indexes: c.indexes })) });
    }

    const colDef = schema.collections.find(c => c.name === collectionName);
    if (!colDef) return send(res, 404, { error: `Collection ${collectionName} not found in schema ${schemaName}` });

    const col = db.collection(collectionName);

    // GET
    if (req.method === "GET") {
      if (docId) {
        const doc = col.findById(docId);
        if (!doc) return send(res, 404, { error: "Document not found" });
        return send(res, 200, doc);
      }
      const filter = parseFilter(query);
      let cursor = col.find(filter);
      if (query.__sort) cursor = cursor.sort(JSON.parse(query.__sort));
      if (query.__limit) cursor = cursor.limit(Number(query.__limit));
      if (query.__skip) cursor = cursor.skip(Number(query.__skip));
      const docs = cursor.toArray();
      return send(res, 200, { schema: schemaName, collection: collectionName, count: docs.length, docs });
    }

    // POST
    if (req.method === "POST") {
      const doc = await readBody(req);
      let errors = validateDoc(schema, collectionName, doc);
      if (errors.length > 0) return send(res, 400, { error: "Validation failed", errors });
      errors = validateRefs(schema, collectionName, doc);
      if (errors.length > 0) return send(res, 400, { error: "Validation failed", errors });
      const inserted = col.insert(doc);
      db.flush();
      return send(res, 201, { inserted, collection: collectionName });
    }

    // PUT/PATCH
    if (req.method === "PUT" || req.method === "PATCH") {
      if (!docId) return send(res, 400, { error: "Document id required" });
      const update = wrapUpdate(await readBody(req));
      const errors = validateDoc(schema, collectionName, update, true);
      if (errors.length > 0) return send(res, 400, { error: "Validation failed", errors });
      col.update({ _id: docId }, update);
      db.flush();
      const updated = col.findById(docId);
      return send(res, 200, { updated, collection: collectionName });
    }

    // DELETE
    if (req.method === "DELETE") {
      if (!docId) return send(res, 400, { error: "Document id required" });
      const before = col.findById(docId);
      if (!before) return send(res, 404, { error: "Document not found" });
      col.removeById(docId);
      db.flush();
      return send(res, 200, { deleted: docId, collection: collectionName });
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("API Error:", err.message);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Production Headless CMS API running on http://localhost:${PORT}`);
  console.log("Auto-imported schemas from: ${EXPORT_DIR}");
  console.log("Data directory: ${DATA_DIR}");
  console.log("");
  console.log("Endpoints:");
  console.log("  GET  /api                    - List schemas");
  console.log("  GET  /api/:schema            - Schema architecture");
  console.log("  GET  /api/:schema/:col       - List documents");
  console.log("  GET  /api/:schema/:col/:id   - Get document");
  console.log("  POST /api/:schema/:col       - Create document");
  console.log("  PUT  /api/:schema/:col/:id   - Update document");
  console.log("  DELETE /api/:schema/:col/:id - Delete document");
});
