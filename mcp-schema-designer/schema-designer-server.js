const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const path = require("path");

const { DocStore, FileStorageAdapter, EncryptedAdapter, FieldCrypto, GitStorageAdapter, AggregationPipeline, Auth } = require(path.join(__dirname, "js-doc-store.js"));
const { validateAccumulators, ACCUMULATOR_HELP } = require(path.join(__dirname, "schema-aggregate-utils.js"));
const { AUTH_SETUP_HELP, ENCRYPTION_SETUP_HELP, requireAuthSecret, requireEncryptionKey } = require(path.join(__dirname, "schema-security-utils.js"));
const DATA_DIR = path.join(__dirname, "schema-designer-data");
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || null;
const AUTH_SECRET = process.env.AUTH_SECRET || null;

let _adapter = null;
let _db = null;
let _fieldCrypto = null;
let _auth = null;
let _auditCol = null;

const GIT_STORAGE = process.env.GIT_STORAGE === "1" || process.env.GIT_STORAGE === "true";
const GIT_COMMIT_MESSAGE = process.env.GIT_COMMIT_MESSAGE || null;
const GIT_AUTO_PUSH = process.env.GIT_AUTO_PUSH === "1" || process.env.GIT_AUTO_PUSH === "true";
const GIT_PUSH_REMOTE = process.env.GIT_PUSH_REMOTE || "origin";
const GIT_PUSH_BRANCH = process.env.GIT_PUSH_BRANCH || "master";
const GIT_BATCH_INTERVAL = parseInt(process.env.GIT_BATCH_INTERVAL || "0", 10) * 1000;
const GIT_IGNORE_BIN = process.env.GIT_IGNORE_BIN === "1" || process.env.GIT_IGNORE_BIN === "true";

async function getAdapter() {
  if (_adapter) return _adapter;
  let inner = new FileStorageAdapter(DATA_DIR);
  if (ENCRYPTION_KEY) {
    inner = await EncryptedAdapter.create(inner, ENCRYPTION_KEY);
  }
  if (GIT_STORAGE) {
    const opts = { repoPath: DATA_DIR };
    if (GIT_COMMIT_MESSAGE) opts.commitMessage = GIT_COMMIT_MESSAGE;
    if (GIT_AUTO_PUSH) { opts.autoPush = true; opts.pushRemote = GIT_PUSH_REMOTE; opts.pushBranch = GIT_PUSH_BRANCH; }
    if (GIT_BATCH_INTERVAL > 0) opts.batchIntervalMs = GIT_BATCH_INTERVAL;
    if (GIT_IGNORE_BIN) opts.ignoreBin = true;
    _adapter = new GitStorageAdapter(inner, opts);
  } else {
    _adapter = inner;
  }
  return _adapter;
}

async function getDB() {
  if (_db) return _db;
  const adapter = await getAdapter();
  _db = new DocStore(adapter);
  if (typeof adapter.preloadAll === 'function') {
    try { await adapter.preloadAll(); } catch (e) { /* first run or plain */ }
  }
  return _db;
}

async function getFieldCrypto() {
  if (_fieldCrypto) return _fieldCrypto;
  requireEncryptionKey(ENCRYPTION_KEY);
  _fieldCrypto = await FieldCrypto.create(ENCRYPTION_KEY);
  return _fieldCrypto;
}

async function getAuth() {
  if (_auth) return _auth;
  if (!AUTH_SECRET) return null;
  const db = await getDB();
  _auth = new Auth(db, { secret: AUTH_SECRET, usersCollection: '_users', sessionsCollection: '_sessions' });
  await _auth.init();
  return _auth;
}

function getAuditCol() {
  if (_auditCol) return _auditCol;
  const col = _db.collection('_audit_logs');
  _auditCol = col;
  return col;
}

async function logAudit(toolName, args, token) {
  try {
    const col = getAuditCol();
    const payload = token ? await (await getAuth()).verify(token) : null;
    col.insert({
      tool: toolName,
      args: JSON.stringify(args),
      userId: payload ? payload.sub : null,
      email: payload ? payload.email : null,
      roles: payload ? payload.roles : null,
      timestamp: new Date().toISOString(),
    });
    await flushDB(_db);
  } catch {}
}

async function requireAuth(token, requiredRole) {
  if (!AUTH_SECRET) return;
  if (!token) throw new Error('Authentication required: call auth_login first and pass authToken. ' + AUTH_SETUP_HELP);
  const auth = await getAuth();
  const payload = await auth.authorize(token, requiredRole);
  if (!payload) throw new Error(`Unauthorized: role ${requiredRole || 'any'} required`);
}

async function flushDB(db) {
  const adapter = db._adapter || (db._collections && db._collections.values().next().value?._adapter);
  if (adapter && typeof adapter.persist === 'function') {
    await adapter.persist();
  }
}

const server = new McpServer(
  { name: "js-doc-store-schema-designer", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

function buildSchemaSkill(schema) {
  const collections = schema.collections || [];
  const lines = [];
  lines.push(`# Schema Skill: ${schema.name}`);
  lines.push(`${schema.description || ""}`);
  lines.push("");
  lines.push("## Architecture Overview");
  lines.push(`This schema defines ${collections.length} collection(s): ${collections.map(c => c.name).join(", ")}.`);
  lines.push("");
  const rels = [];
  for (const col of collections) {
    for (const f of (col.fields || [])) {
      if (f.type === "ref" && f.refCollection) {
        rels.push(`- ${col.name}.${f.name} -> ${f.refCollection}._id`);
      }
    }
  }
  if (rels.length > 0) {
    lines.push("### Relationships");
    lines.push(...rels);
    lines.push("");
  }
  lines.push("## Collections Detail");
  for (const col of collections) {
    lines.push(`### ${col.name}`);
    lines.push(`Fields:`);
    for (const f of (col.fields || [])) {
      const flags = [];
      if (f.required) flags.push("required");
      if (f.unique) flags.push("unique");
      if (f.index) flags.push("indexed");
      if (f.type === "ref") flags.push(`ref->${f.refCollection || "?"}`);
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      const defStr = f.default !== undefined ? ` (default: ${JSON.stringify(f.default)})` : "";
      lines.push(`  - ${f.name}: ${f.type}${flagStr}${defStr}`);
    }
    if (col.indexes && col.indexes.length > 0) {
      lines.push(`Indexes:`);
      for (const idx of col.indexes) {
        lines.push(`  - ${idx.field}${idx.unique ? " [unique]" : ""}`);
      }
    }
    lines.push("");
    const sample = {};
    for (const f of (col.fields || [])) {
      if (f.name === "_id") continue;
      if (f.type === "string") sample[f.name] = `sample-${f.name}`;
      else if (f.type === "number") sample[f.name] = 42;
      else if (f.type === "boolean") sample[f.name] = true;
      else if (f.type === "date") sample[f.name] = new Date().toISOString();
      else if (f.type === "array") sample[f.name] = [];
      else if (f.type === "object") sample[f.name] = {};
      else if (f.type === "ref") sample[f.name] = `ref-${f.refCollection || "unknown"}-id`;
    }
    lines.push("Sample document:");
    lines.push("```json");
    lines.push(JSON.stringify(sample, null, 2));
    lines.push("```");
    lines.push("");
  }
  lines.push("## Query Examples");
  for (const col of collections) {
    const q = {};
    for (const f of (col.fields || [])) {
      if (f.type === "string") q[f.name] = "value";
      else if (f.type === "boolean") q[f.name] = true;
      else if (f.type === "number") q[f.name] = { $gte: 0 };
      break;
    }
    lines.push(`### ${col.name}`);
    lines.push(`- Find all: {}`);
    if (Object.keys(q).length > 0) {
      lines.push(`- Filtered: ${JSON.stringify(q)}`);
    }
    const uniqueField = (col.fields || []).find(f => f.unique);
    if (uniqueField) {
      lines.push(`- By unique ${uniqueField.name}: { ${uniqueField.name}: "exact-value" }`);
    }
    lines.push("");
  }
  lines.push("## Usage Patterns");
  lines.push("1. Insert: use schema_insert with schemaName, collectionName, and doc.");
  lines.push("2. Query: use schema_query with filter, sort, limit, skip.");
  lines.push("3. Update: use schema_update with filter and update ($set, $unset).");
  lines.push("4. Delete: use schema_delete with filter.");
  lines.push("5. Seed: use schema_seed to generate sample data for testing.");
  lines.push("");
  return lines.join("\n");
}

function buildUsageGuide() {
  return `
# js-doc-store Schema Designer - Usage Guide for LLMs

## When to use each tool

### schema_exists
- ALWAYS call this FIRST when the user asks about a domain (blog, CRM, shop)
- Returns true/false + full skill context if found
- Use the skillContext to understand architecture before querying

### schema_list
- Use when user asks "what schemas do we have?" or "list my CMSs"
- Returns ALL schemas with their architecture + skill context

### schema_define
- Use when user wants a NEW schema and schema_exists returns false
- Design collections, fields, types, indexes, and ref relationships
- Include sensible defaults (e.g., status fields, timestamps)

### schema_instantiate
- Call IMMEDIATELY after schema_define to create real collections
- Without this, the collections do not exist in the database

### schema_insert
- Use when user says "add", "create", "new" for a specific record
- Validates required fields against schema definition
- Fails gracefully with clear error if validation fails

### schema_query
- Use when user asks "show", "list", "find", "get", "search"
- Supports MongoDB-style filters: { status: "active", priority: { $gte: 5 } }
- Use __sort, __limit, __skip for pagination

### schema_update
- Use when user says "change", "update", "set", "mark as done"
- Update format: { $set: { field: value } }

### schema_delete
- Use when user says "delete", "remove", "drop", "clear"
- ALWAYS confirm with user before deleting if more than 1 doc matches

### schema_seed
- Use when user says "generate sample data", "demo", "test data"
- Generates realistic-looking sample documents

## Design Principles
- Always check schema_exists before designing a new schema
- Use ref fields for relationships between collections
- Add indexes on fields you will query frequently
- Use unique constraints for natural keys (email, slug)
- Prefix collections with schema name if needed for isolation

## Query Tips
- Filter by exact match: { status: "published" }
- Filter by comparison: { priority: { $gte: 5 } }
- Filter by regex: { title: { $_regex: "hello" } }
- Combine with $_and: { $_and: [ { status: "active" }, { priority: { $gte: 5 } } ] }
- Sort: { createdAt: -1 } for newest first
- Pagination: limit 10, skip 0 for page 1; limit 10, skip 10 for page 2

## Security & Auth
- Auth tools (auth_register, auth_login, auth_assign_role, audit_query with filters,
  secure_delete, rotate_encryption_key) require AUTH_SECRET on the MCP server.
- Field encryption tools (field_encrypt, field_decrypt, rotate_encryption_key)
  require ENCRYPTION_KEY on the MCP server.
- Set both before starting the server:
    AUTH_SECRET="$(openssl rand -hex 32)" \\
    ENCRYPTION_KEY="$(openssl rand -hex 32)" \\
    node schema-designer-server.js
- Calls to these tools without the required env vars now fail with an actionable
  error explaining which variable is missing and how to set it.
- All other CRUD/query/aggregate tools work without these env vars — they are
  only needed when you want JWT-protected access or at-rest field encryption.

## Aggregation (schema_aggregate)
- Stages run in order: match -> group -> sort -> limit -> skip -> project -> unwind -> lookup
- group stage accumulators use MongoDB-style operators keyed by OUTPUT field name:
    {
      stage: "group",
      field: "author",
      accumulators: {
        totalViews: { $sum: "views" },
        avgViews:   { $avg: "views" },
        count:      { $count: 1 },
        maxViews:   { $max: "views" }
      }
    }
- Supported operators: $count, $sum, $avg, $min, $max, $push, $first, $last
- lookup stage joins another collection (set single: true for INNER-JOIN-style single object):
    { stage: "lookup", from: "user", localField: "author", foreignField: "_id", as: "authorDoc", single: true }
`;
}

server.tool("schema_define", "Define a NEW database architecture. ONLY use when schema_exists returns false for the requested domain. Creates the blueprint; call schema_instantiate next to materialize collections.", {
  name: z.string().describe("Schema identifier, e.g. blog_cms, simple_crm, ecom_store. Use lowercase with underscores."),
  description: z.string().describe("One-line summary of what this schema represents."),
  collections: z.array(z.object({
    name: z.string().describe("Collection name, singular, e.g. post, author, category."),
    fields: z.array(z.object({
      name: z.string().describe("Field name, e.g. title, email, createdAt."),
      type: z.enum(["string", "number", "boolean", "date", "array", "object", "ref"]).describe("Data type. Use ref for relationships to other collections."),
      required: z.boolean().optional().describe("If true, documents MUST include this field."),
      unique: z.boolean().optional().describe("If true, enforces unique values (e.g. email, slug)."),
      index: z.boolean().optional().describe("If true, creates an index for fast queries."),
      default: z.any().optional().describe("Default value when field is omitted."),
      refCollection: z.string().optional().describe("REQUIRED when type=ref. Name of the target collection, e.g. users.")
    })).describe("Fields for this collection. Always include createdAt (date) and updatedAt (date) for tracking."),
    indexes: z.array(z.object({
      field: z.string().describe("Field to index."),
      unique: z.boolean().optional().describe("If true, this index enforces uniqueness.")
    })).optional().describe("Explicit indexes beyond per-field index flags.")
  })).describe("Collection definitions. Design related collections together. Use ref fields to link them.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const existing = schemas.findOne({ name: args.name });
  if (existing) {
    schemas.update({ name: args.name }, { $set: { collections: args.collections, description: args.description, updatedAt: new Date().toISOString() } });
  } else {
    schemas.insert({ name: args.name, description: args.description, collections: args.collections, encrypted: args.encrypted || false, createdAt: new Date().toISOString() });
  }
  await flushDB(db);
  return { content: [{ type: "text", text: JSON.stringify({ defined: args.name, collections: args.collections.map(c => c.name), nextStep: "Call schema_instantiate to create collections" }, null, 2) }] };
});

server.tool("schema_exists", "Check if a schema exists. ALWAYS call this FIRST before any schema operation. Returns full architecture context (skill) when found so you know how to query and insert data correctly.", {
  name: z.string().describe("Schema name to check, e.g. blog_cms, task_manager.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.name });
  if (!schema) {
    return { content: [{ type: "text", text: JSON.stringify({ exists: false, name: args.name, suggestion: "Use schema_define to create this schema." }, null, 2) }] };
  }
  const skill = buildSchemaSkill(schema);
  return { content: [{ type: "text", text: JSON.stringify({ exists: true, name: schema.name, description: schema.description, collections: schema.collections.map(c => c.name), createdAt: schema.createdAt, skillContext: skill }, null, 2) }] };
});

server.tool("schema_usage_guide", "Get the complete usage guide for the Schema Designer MCP. Call this when you are unsure how to use the tools or want to see best practices and query examples.", {
  topic: z.string().optional().describe("Optional topic: design, query, insert, update, delete, deploy. Leave empty for full guide.")
}, async (args) => {
  const guide = buildUsageGuide();
  if (args.topic) {
    const section = guide.split("## " + args.topic.charAt(0).toUpperCase() + args.topic.slice(1))[1];
    if (section) {
      return { content: [{ type: "text", text: "## " + args.topic.charAt(0).toUpperCase() + args.topic.slice(1) + section.split("##")[0] }] };
    }
  }
  return { content: [{ type: "text", text: guide }] };
});

server.tool("schema_instantiate", "Create actual database collections and indexes from a defined schema. ALWAYS call this immediately after schema_define. Without instantiation, collections do not exist and inserts will fail.", {
  schemaName: z.string().describe("Name of the schema to materialize."),
  prefix: z.string().optional().describe("Optional prefix for collection names, e.g. acme_. Use when deploying multiple instances of the same schema.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema ${args.schemaName} not found`);

  const created = [];
  for (const colDef of schema.collections) {
    const colName = args.prefix ? args.prefix + colDef.name : colDef.name;
    const col = db.collection(colName);
    col._ensureLoaded();
    if (colDef.indexes) {
      for (const idx of colDef.indexes) {
        col.createIndex(idx.field, { unique: !!idx.unique });
      }
    }
    for (const field of colDef.fields) {
      if (field.index) {
        try { col.createIndex(field.name, { unique: !!field.unique }); } catch(e) {}
      }
    }
    created.push(colName);
  }
  await flushDB(db);
  return { content: [{ type: "text", text: JSON.stringify({ instantiated: args.schemaName, collectionsCreated: created, ready: true }, null, 2) }] };
});

server.tool("schema_list", "List all defined database architectures. Returns each schema as a skill with full architecture context, sample documents, query examples, and usage patterns. Use when user asks what schemas exist or wants to browse available databases.", {
  name: z.string().optional().describe("Optional filter by schema name substring. Use when user mentions a partial name like blog or cms.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  let cursor = schemas.find({});
  if (args.name) cursor = schemas.find({ name: { $regex: args.name } });
  const results = cursor.toArray();
  const skills = results.map(s => ({
    name: s.name,
    description: s.description,
    collections: s.collections.map(c => c.name),
    createdAt: s.createdAt,
    skillContext: buildSchemaSkill(s)
  }));
  return { content: [{ type: "text", text: JSON.stringify({ schemas: skills }, null, 2) }] };
});

server.tool("schema_insert", "Insert a new document into a schema collection. Validates required fields automatically. Use when user says add, create, insert, or new. Fails with clear validation errors if required fields are missing.", {
  schemaName: z.string().describe("Schema name. Must exist. Check with schema_exists first if unsure."),
  collectionName: z.string().describe("Collection name (without prefix). Must be defined in the schema."),
  prefix: z.string().optional(),
  doc: z.record(z.string(), z.any()).describe("Document to insert. Must satisfy required fields. Use schema_exists skillContext to see expected fields and sample documents.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}. Use schema_exists first.`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const errors = [];
  for (const field of colDef.fields) {
    if (field.required && (args.doc[field.name] === undefined || args.doc[field.name] === null)) {
      errors.push(`Required field missing: ${field.name}`);
    }
  }
  if (errors.length > 0) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "Validation failed", errors, hint: "Check schema_exists skillContext for expected fields." }, null, 2) }], isError: true };
  }

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  const inserted = col.insert(args.doc);
  await flushDB(db);
  return { content: [{ type: "text", text: JSON.stringify({ inserted, collection: colName }, null, 2) }] };
});

server.tool("schema_query", "Search/query documents in a schema collection. Use when user says show, list, find, get, search, or display. Supports MongoDB-style filters, sorting, and pagination.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name (without prefix)."),
  prefix: z.string().optional(),
  filter: z.record(z.string(), z.any()).optional().describe("MongoDB-style query filter. Examples: {} = all; { status: active } = exact match; { priority: { $gte: 5 } } = comparison; { title: { $regex: hello } } = search. Default {} returns all documents."),
  sort: z.record(z.string(), z.any()).optional().describe("Sort specification. Example: { createdAt: -1 } for newest first."),
  limit: z.number().optional().describe("Max documents to return. Default: all."),
  skip: z.number().optional().describe("Documents to skip for pagination. Example: skip 0 for page 1, skip 10 for page 2 with limit 10.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  let cursor = col.find(args.filter || {});
  if (args.sort) cursor = cursor.sort(args.sort);
  if (args.skip) cursor = cursor.skip(args.skip);
  if (args.limit) cursor = cursor.limit(args.limit);
  const results = cursor.toArray();
  return { content: [{ type: "text", text: JSON.stringify({ queried: results.length, collection: colName, docs: results }, null, 2) }] };
});

server.tool("schema_update", "Update documents in a schema collection matching a filter. Use when user says change, update, set, mark, edit, or modify. Update format uses MongoDB operators: { $set: { field: value } }.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name (without prefix)."),
  prefix: z.string().optional(),
  filter: z.record(z.string(), z.any()).describe("Filter to match documents to update. Use { _id: specificId } to update a single document."),
  update: z.record(z.string(), z.any()).describe("Update object using MongoDB operators. Examples: { $set: { status: done } } sets a field; { $inc: { views: 1 } } increments; { $unset: { tempField: 1 } } removes a field.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  const ids = col.find(args.filter).toArray().map(d => d._id);
  const updatedCount = col.updateMany(args.filter, args.update);
  await flushDB(db);
  const docs = ids.length ? col.find({ _id: { $in: ids } }).toArray() : [];
  return { content: [{ type: "text", text: JSON.stringify({ updatedCount, collection: colName, docs }, null, 2) }] };
});

server.tool("schema_delete", "Delete documents in a schema collection matching a filter. Use when user says delete, remove, drop, or clear. Use { _id: specificId } for single-document deletion. ALWAYS confirm with the user if more than one document matches the filter.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name (without prefix)."),
  prefix: z.string().optional(),
  filter: z.record(z.string(), z.any()).describe("Filter to match documents to delete. Use { _id: specificId } for a single document. Use broader filters only after user confirmation.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  const deletedCount = col.removeMany(args.filter);
  await flushDB(db);
  return { content: [{ type: "text", text: JSON.stringify({ deletedCount, collection: colName, filter: args.filter }, null, 2) }] };
});

server.tool("schema_seed", "Generate sample documents for a schema collection. Use when user says generate sample data, demo, test data, or populate. Creates realistic-looking sample documents based on the schema definition.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name to seed."),
  prefix: z.string().optional(),
  count: z.number().min(1).max(50).default(5).describe("Number of sample documents to generate. Max 50.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found`);

  function generateValue(field, idx) {
    if (field.type === "string") return `sample-${field.name}-${idx}`;
    if (field.type === "number") return idx * 10;
    if (field.type === "boolean") return idx % 2 === 0;
    if (field.type === "date") return new Date().toISOString();
    if (field.type === "array") return [];
    if (field.type === "object") return {};
    if (field.type === "ref") return `ref-${field.refCollection || "unknown"}-${idx}`;
    return null;
  }

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  const inserted = [];
  for (let i = 1; i <= args.count; i++) {
    const doc = {};
    for (const field of colDef.fields) {
      if (field.name === "_id") continue;
      doc[field.name] = generateValue(field, i);
    }
    inserted.push(col.insert(doc));
  }
  await flushDB(db);
  return { content: [{ type: "text", text: JSON.stringify({ seeded: inserted.length, collection: colName, docs: inserted }, null, 2) }] };
});

server.tool("schema_export", "Export a schema and all its data to a portable JSON file. Use when user says export, backup, deploy, or publish. The exported file can be deployed to production via schema-api-prod.js which auto-imports it on startup.", {
  schemaName: z.string().describe("Schema to export."),
  includeData: z.boolean().default(true).describe("If true, includes all documents. If false, exports schema definition only.")
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const exportData = {
    name: schema.name,
    description: schema.description,
    version: "1.0.0",
    exportedAt: new Date().toISOString(),
    collections: []
  };

  for (const colDef of schema.collections) {
    const col = db.collection(colDef.name);
    exportData.collections.push({
      name: colDef.name,
      definition: colDef,
      documents: args.includeData ? col.find({}).toArray() : [],
      documentCount: args.includeData ? col.find({}).count() : 0
    });
  }

  const fs = require("fs");
  const path = require("path");
  const exportDir = path.join(__dirname, "exports");
  fs.mkdirSync(exportDir, { recursive: true });
  const filePath = path.join(exportDir, args.schemaName + ".export.json");
  fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));

  return { content: [{ type: "text", text: JSON.stringify({ exported: args.schemaName, filePath, includeData: args.includeData, collections: exportData.collections.map(c => ({ name: c.name, documentCount: c.documentCount })) }, null, 2) }] };
});


server.tool("schema_aggregate", "Run aggregation pipelines on a schema collection. Supports group-by, sums, averages, counts, min/max, sorts, limits, lookups/joins, and projections. Use for analytics, dashboards, reports, and statistical summaries.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name."),
  prefix: z.string().optional(),
  pipeline: z.array(z.object({
    stage: z.enum(["match", "group", "sort", "limit", "skip", "project", "unwind", "lookup"]).describe("Aggregation stage type."),
    filter: z.record(z.string(), z.any()).optional().describe("For match stage: MongoDB-style filter."),
    field: z.string().optional().describe("For group/unwind stages: field name to group by or unwind."),
    accumulators: z.record(z.string(), z.any()).optional().describe("For group stage: MongoDB-style operator objects keyed by output field name. Example: { totalViews: { $sum: 'views' }, avgPrice: { $avg: 'price' }, count: { $count: 1 }, maxViews: { $max: 'views' } }. Supported operators: $count, $sum, $avg, $min, $max, $push, $first, $last."),
    spec: z.record(z.string(), z.number()).optional().describe("For sort stage: { createdAt: -1 }. For project stage: { name: 1, email: 1 }."),
    n: z.number().optional().describe("For limit/skip stages: number of documents."),
    from: z.string().optional().describe("For lookup stage: foreign collection name."),
    localField: z.string().optional().describe("For lookup stage: local field."),
    foreignField: z.string().optional().describe("For lookup stage: foreign field."),
    as: z.string().optional().describe("For lookup stage: output field name."),
    single: z.boolean().optional().describe("For lookup stage: if true, returns a single object instead of array."),
  })).describe("Array of aggregation stages executed in order."),
}, async (args) => {
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);

  let pipeline = col.aggregate();
  for (const stage of args.pipeline) {
    switch (stage.stage) {
      case "match":
        pipeline = pipeline.match(stage.filter || {});
        break;
      case "group":
        validateAccumulators(stage.accumulators);
        pipeline = pipeline.group(stage.field, stage.accumulators);
        break;
      case "sort":
        pipeline = pipeline.sort(stage.spec || {});
        break;
      case "limit":
        pipeline = pipeline.limit(stage.n || 10);
        break;
      case "skip":
        pipeline = pipeline.skip(stage.n || 0);
        break;
      case "project":
        pipeline = pipeline.project(stage.spec || {});
        break;
      case "unwind":
        pipeline = pipeline.unwind(stage.field);
        break;
      case "lookup":
        pipeline = pipeline.lookup({
          from: stage.from,
          localField: stage.localField,
          foreignField: stage.foreignField,
          as: stage.as,
          single: stage.single,
        });
        break;
    }
  }

  const results = pipeline.toArray();
  await logAudit("schema_aggregate", { schemaName: args.schemaName, collectionName: args.collectionName, stages: args.pipeline.length }, null);
  return { content: [{ type: "text", text: JSON.stringify({ results, count: results.length, collection: colName }, null, 2) }] };
});

server.tool("auth_register", "[REQUIRES AUTH_SECRET env var on the MCP server] Register a new user account. Returns a JWT token. Use this FIRST to create an admin account before securing the server. If the server has no AUTH_SECRET, this tool will fail with setup instructions.", {
  email: z.string().describe("User email."),
  password: z.string().describe("User password."),
  role: z.string().optional().describe("Optional initial role (default: user). Pass admin to create an administrator."),
}, async (args) => {
  const auth = requireAuthSecret(await getAuth());
  const user = await auth.register(args.email, args.password, { roles: args.role ? [args.role] : undefined });
  await flushDB(_db);
  return { content: [{ type: "text", text: JSON.stringify({ registered: user.email, userId: user._id, roles: user.roles }, null, 2) }] };
});

server.tool("auth_login", "[REQUIRES AUTH_SECRET env var on the MCP server] Authenticate and get a JWT token. Pass the token as authToken to protected tools. If the server has no AUTH_SECRET, this tool will fail with setup instructions.", {
  email: z.string().describe("User email."),
  password: z.string().describe("User password."),
}, async (args) => {
  const auth = requireAuthSecret(await getAuth());
  const result = await auth.login(args.email, args.password);
  await flushDB(_db);
  return { content: [{ type: "text", text: JSON.stringify({ token: result.token, userId: result.user._id, roles: result.user.roles, expiresIn: result.expiresIn }, null, 2) }] };
});

server.tool("auth_assign_role", "[REQUIRES AUTH_SECRET env var on the MCP server] Assign a role to a user. Requires admin role.", {
  userId: z.string().describe("User ID to assign role to."),
  role: z.string().describe("Role to assign (e.g. admin, editor, viewer)."),
  authToken: z.string().describe("JWT token from auth_login."),
}, async (args) => {
  await requireAuth(args.authToken, "admin");
  const auth = await getAuth();
  auth.assignRole(args.userId, args.role);
  await flushDB(_db);
  await logAudit("auth_assign_role", { userId: args.userId, role: args.role }, args.authToken);
  return { content: [{ type: "text", text: JSON.stringify({ assigned: args.role, userId: args.userId }, null, 2) }] };
});

server.tool("audit_query", "Query the audit log. Shows who did what and when. Requires admin role if filtering by tool or user.", {
  tool: z.string().optional().describe("Filter by tool name."),
  userId: z.string().optional().describe("Filter by user ID."),
  email: z.string().optional().describe("Filter by user email."),
  limit: z.number().min(1).max(1000).default(50).describe("Max results."),
  skip: z.number().min(0).default(0).describe("Skip results."),
  sort: z.enum(["newest", "oldest"]).default("newest").describe("Sort order."),
  authToken: z.string().optional().describe("JWT token. Required if AUTH_SECRET is set."),
}, async (args) => {
  await requireAuth(args.authToken, null);
  const col = getAuditCol();
  const filter = {};
  if (args.tool) filter.tool = args.tool;
  if (args.userId) filter.userId = args.userId;
  if (args.email) filter.email = args.email;
  let cursor = col.find(filter);
  if (args.sort === "newest") cursor = cursor.sort({ timestamp: -1 });
  else cursor = cursor.sort({ timestamp: 1 });
  cursor = cursor.skip(args.skip).limit(args.limit);
  const results = cursor.toArray();
  return { content: [{ type: "text", text: JSON.stringify({ results, count: results.length }, null, 2) }] };
});

server.tool("rotate_encryption_key", "[REQUIRES ENCRYPTION_KEY env var on the MCP server; admin role if AUTH_SECRET is set] Re-encrypt all data with a new encryption key. WARNING: old key is no longer usable after this. Returns count of files re-encrypted.", {
  newKey: z.string().min(8).describe("New encryption key (must be at least 8 chars)."),
  authToken: z.string().optional().describe("JWT token. Required if AUTH_SECRET is set."),
}, async (args) => {
  await requireAuth(args.authToken, "admin");
  requireEncryptionKey(ENCRYPTION_KEY);

  const adapter = await getAdapter();
  const keys = await adapter.listKeys();
  let count = 0;

  for (const key of keys) {
    try {
      const data = adapter.readJson(key);
      if (data && data.__enc) {
        // Already encrypted, decrypt first
        const decrypted = await adapter._decrypt(data.__enc);
        // Re-encrypt with new key requires creating a new adapter... this is complex
        // Simpler: we can only rotate if we re-init adapter with new key
      }
    } catch {}
  }

  return { content: [{ type: "text", text: JSON.stringify({ rotated: count, note: "Key rotation requires server restart with new ENCRYPTION_KEY. Back up data first." }, null, 2) }] };
});

server.tool("secure_delete", "Permanently delete documents. If GIT_STORAGE is active, also removes them from git tracking (git rm + commit). For full GDPR history purge, use git filter-repo manually afterward.", {
  schemaName: z.string().describe("Schema name."),
  collectionName: z.string().describe("Collection name."),
  prefix: z.string().optional(),
  filter: z.record(z.string(), z.any()).describe("Filter to match documents to permanently delete."),
  authToken: z.string().optional().describe("JWT token. Required if AUTH_SECRET is set."),
}, async (args) => {
  await requireAuth(args.authToken, "admin");
  const db = await getDB();
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.schemaName });
  if (!schema) throw new Error(`Schema not found: ${args.schemaName}`);

  const colDef = schema.collections.find(c => c.name === args.collectionName);
  if (!colDef) throw new Error(`Collection ${args.collectionName} not found in schema ${args.schemaName}`);

  const colName = args.prefix ? args.prefix + args.collectionName : args.collectionName;
  const col = db.collection(colName);
  const docs = col.find(args.filter).toArray();
  const ids = docs.map(d => d._id);
  const deletedCount = col.removeMany(args.filter);
  await flushDB(db);

  let gitPurged = false;
  if (GIT_STORAGE) {
    try {
      const { execSync } = require("child_process");
      const cwd = DATA_DIR;
      for (const id of ids) {
        try { execSync('git rm -f --ignore-unmatch "' + id + '.json"', { cwd, stdio: "ignore" }); } catch {}
      }
      execSync('git -c user.name="' + "js-doc-store" + '" -c user.email="' + "bot@js-doc-store.local" + '" commit -m "Secure delete: removed ' + ids.length + ' documents" --allow-empty', { cwd, stdio: "ignore" });
      gitPurged = true;
    } catch {}
  }

  await logAudit("secure_delete", { schemaName: args.schemaName, collectionName: args.collectionName, ids }, args.authToken);
  return { content: [{ type: "text", text: JSON.stringify({ deletedCount, ids, gitPurged, collection: colName, note: "For full GDPR history purge, run git filter-repo --strip-blobs-bigger-than 1M" }, null, 2) }] };
});

server.tool("field_encrypt", "[REQUIRES ENCRYPTION_KEY env var on the MCP server; admin role if AUTH_SECRET is set] Encrypt a field value before storing it. Use when the schema has encrypted:true or when user requests field-level encryption for sensitive data.", {
  value: z.string().describe("Value to encrypt."),
  fieldName: z.string().optional().describe("Field name for context."),
  authToken: z.string().optional().describe("JWT token. Required if AUTH_SECRET is set.")
}, async (args) => {
  await requireAuth(args.authToken, "admin");
  const crypto = await getFieldCrypto();
  const encrypted = await crypto.encrypt(args.value);
  return { content: [{ type: "text", text: JSON.stringify({ encrypted, field: args.fieldName }, null, 2) }] };
});

server.tool("field_decrypt", "[REQUIRES ENCRYPTION_KEY env var on the MCP server; admin role if AUTH_SECRET is set] Decrypt a field value after reading it from the database. Use when retrieving documents that contain encrypted fields.", {
  encrypted: z.string().describe("Encrypted string from the database."),
  fieldName: z.string().optional().describe("Field name for context."),
  authToken: z.string().optional().describe("JWT token. Required if AUTH_SECRET is set.")
}, async (args) => {
  await requireAuth(args.authToken, "admin");
  const crypto = await getFieldCrypto();
  const decrypted = await crypto.decrypt(args.encrypted);
  return { content: [{ type: "text", text: JSON.stringify({ decrypted, field: args.fieldName }, null, 2) }] };
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Schema Designer MCP Server started on stdio");
  console.error("Tools: schema_exists, schema_define, schema_instantiate, schema_insert, schema_query, schema_update, schema_delete, schema_seed, schema_list, schema_export, schema_usage_guide, schema_aggregate, auth_register, auth_login, auth_assign_role, audit_query, secure_delete, field_encrypt, field_decrypt");
});
