const http = require("http");
const url = require("url");
const path = require("path");

const { DocStore, FileStorageAdapter, Auth } = require(path.join(__dirname, "js-doc-store.js"));
const db = new DocStore(new FileStorageAdapter(path.join(__dirname, "schema-designer-data")));
const auth = new Auth(db, { secret: process.env.JWT_SECRET || "change-me-in-production", tokenExpiry: 86400 });

const PORT = process.env.PORT || 3000;

(async () => {
  await auth.init();
  console.log("Auth initialized");
})();

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data, null, 2));
}

async function getBearer(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return null;
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

function parseFilter(query) {
  const filter = {};
  for (const [key, val] of Object.entries(query)) {
    if (key.startsWith("__")) continue;
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
    // Auth routes (public)
    if (pathname === "/auth/register" && req.method === "POST") {
      const body = await readBody(req);
      const user = await auth.register(body.email, body.password, body.profile || {});
      return send(res, 201, { user });
    }
    if (pathname === "/auth/login" && req.method === "POST") {
      const body = await readBody(req);
      const result = await auth.login(body.email, body.password);
      return send(res, 200, result);
    }
    if (pathname === "/auth/me" && req.method === "GET") {
      const token = await getBearer(req);
      const payload = await auth.verify(token);
      if (!payload) return send(res, 401, { error: "Unauthorized" });
      const user = auth.getUser(payload.sub);
      return send(res, 200, { user });
    }
    if (pathname === "/auth/logout" && req.method === "POST") {
      const token = await getBearer(req);
      if (token) auth.logout(token);
      return send(res, 200, { loggedOut: true });
    }

    // Admin: list users (requires admin role)
    if (pathname === "/admin/users" && req.method === "GET") {
      const token = await getBearer(req);
      const payload = await auth.authorize(token, "admin");
      if (!payload) return send(res, 403, { error: "Admin required" });
      const usersCol = db.collection(auth.usersCol);
      const users = usersCol.find({}).toArray().map(u => { delete u.passwordHash; return u; });
      return send(res, 200, { users });
    }

    // Schema discovery (public)
    if (pathname === "/api") {
      const schemas = db.collection("__schemas");
      const all = schemas.find({}).toArray();
      return send(res, 200, { api: "js-doc-store-headless", version: "2.0.0", schemas: all.map(s => ({ name: s.name, description: s.description, collections: s.collections.map(c => c.name) })) });
    }

    const m = pathname.match(/^\/api\/([^\/]+)(?:\/([^\/]+))?(?:\/([^\/]+))?$/);
    if (!m) return send(res, 404, { error: "Not found. Use /auth/*, /api/:schema/:collection or /api" });

    const [, schemaName, collectionName, docId] = m;
    const schema = getSchema(schemaName);
    if (!schema) return send(res, 404, { error: `Schema ${schemaName} not found` });

    if (!collectionName) {
      return send(res, 200, { schema: schema.name, description: schema.description, collections: schema.collections.map(c => ({ name: c.name, fields: c.fields, indexes: c.indexes })) });
    }

    const colDef = schema.collections.find(c => c.name === collectionName);
    if (!colDef) return send(res, 404, { error: `Collection ${collectionName} not found in schema ${schemaName}` });

    const col = db.collection(collectionName);
    const token = await getBearer(req);
    const payload = token ? await auth.verify(token) : null;

    // GET /api/:schema/:collection or /api/:schema/:collection/:id
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

    // Protected writes: require auth
    if (!payload) return send(res, 401, { error: "Authentication required. Use /auth/login to get a token." });

    // POST /api/:schema/:collection
    if (req.method === "POST") {
      const doc = await readBody(req);
      const errors = validateDoc(schema, collectionName, doc);
      if (errors.length > 0) return send(res, 400, { error: "Validation failed", errors });
      const inserted = col.insert(doc);
      db.flush();
      return send(res, 201, { inserted, collection: collectionName });
    }

    // PUT/PATCH /api/:schema/:collection/:id
    if (req.method === "PUT" || req.method === "PATCH") {
      if (!docId) return send(res, 400, { error: "Document id required" });
      const update = await readBody(req);
      const errors = validateDoc(schema, collectionName, update, true);
      if (errors.length > 0) return send(res, 400, { error: "Validation failed", errors });
      col.update({ _id: docId }, update);
      db.flush();
      const updated = col.findById(docId);
      return send(res, 200, { updated, collection: collectionName });
    }

    // DELETE /api/:schema/:collection/:id
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
  console.log(`Headless CMS API with Auth running on http://localhost:${PORT}`);
  console.log("Endpoints:");
  console.log("  POST /auth/register         - Register new user");
  console.log("  POST /auth/login            - Login, returns JWT");
  console.log("  GET  /auth/me               - Current user profile");
  console.log("  POST /auth/logout           - Invalidate token");
  console.log("  GET  /api                   - List schemas");
  console.log("  GET  /api/:schema           - Schema architecture");
  console.log("  GET  /api/:schema/:col      - List docs (public read)");
  console.log("  POST /api/:schema/:col      - Create doc (auth required)");
  console.log("  PUT  /api/:schema/:col/:id  - Update doc (auth required)");
  console.log("  DELETE /api/:schema/:col/:id- Delete doc (auth required)");
  console.log("  GET  /admin/users           - List all users (admin only)");
});
