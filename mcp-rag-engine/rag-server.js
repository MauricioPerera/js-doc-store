const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const path = require("path");

const { DocStore, FileStorageAdapter, EncryptedAdapter, GitStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const { VectorStore, BM25Index, HybridSearch, MemoryStorageAdapter } = require(path.join(__dirname, "js-vector-store.js"));

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "embeddinggemma:latest";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "rag-data");
const VECTOR_DIR = process.env.VECTOR_DIR || path.join(__dirname, "rag-vectors");

const server = new McpServer(
  { name: "js-doc-store-rag", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

async function generateEmbedding(text) {
  const res = await fetch(OLLAMA_HOST + "/api/embeddings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama embedding failed: ${res.status} ${await res.text()}`);
  return (await res.json()).embedding;
}

const docStores = new Map();
const vectorStores = new Map();
const bm25s = new Map();
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || null;

const GIT_STORAGE = process.env.GIT_STORAGE === "1" || process.env.GIT_STORAGE === "true";
const GIT_COMMIT_MESSAGE = process.env.GIT_COMMIT_MESSAGE || null;
const GIT_AUTO_PUSH = process.env.GIT_AUTO_PUSH === "1" || process.env.GIT_AUTO_PUSH === "true";
const GIT_PUSH_REMOTE = process.env.GIT_PUSH_REMOTE || "origin";
const GIT_PUSH_BRANCH = process.env.GIT_PUSH_BRANCH || "master";
const GIT_BATCH_INTERVAL = parseInt(process.env.GIT_BATCH_INTERVAL || "0", 10) * 1000;
const GIT_IGNORE_BIN = process.env.GIT_IGNORE_BIN === "1" || process.env.GIT_IGNORE_BIN === "true";

function _wrapAdapter(inner, dir) {
  if (ENCRYPTION_KEY) {
    throw new Error("Use _wrapAdapterAsync for encrypted adapters");
  }
  if (GIT_STORAGE) {
    const opts = { repoPath: dir };
    if (GIT_COMMIT_MESSAGE) opts.commitMessage = GIT_COMMIT_MESSAGE;
    if (GIT_AUTO_PUSH) { opts.autoPush = true; opts.pushRemote = GIT_PUSH_REMOTE; opts.pushBranch = GIT_PUSH_BRANCH; }
    if (GIT_BATCH_INTERVAL > 0) opts.batchIntervalMs = GIT_BATCH_INTERVAL;
    return new GitStorageAdapter(inner, opts);
  }
  return inner;
}

async function _wrapAdapterAsync(inner, dir) {
  let adapter = inner;
  if (ENCRYPTION_KEY) {
    adapter = await EncryptedAdapter.create(inner, ENCRYPTION_KEY);
  }
  if (GIT_STORAGE) {
    const opts = { repoPath: dir };
    if (GIT_COMMIT_MESSAGE) opts.commitMessage = GIT_COMMIT_MESSAGE;
    if (GIT_AUTO_PUSH) { opts.autoPush = true; opts.pushRemote = GIT_PUSH_REMOTE; opts.pushBranch = GIT_PUSH_BRANCH; }
    if (GIT_BATCH_INTERVAL > 0) opts.batchIntervalMs = GIT_BATCH_INTERVAL;
    if (GIT_IGNORE_BIN) opts.ignoreBin = true;
    adapter = new GitStorageAdapter(adapter, opts);
  }
  return adapter;
}

async function getDocStore(name) {
  if (docStores.has(name)) return docStores.get(name);
  const dir = path.join(DATA_DIR, name);
  const inner = new FileStorageAdapter(dir);
  const adapter = await _wrapAdapterAsync(inner, dir);
  const db = new DocStore(adapter);
  if (typeof adapter.preloadAll === 'function') {
    try { await adapter.preloadAll(); } catch (e) { /* first run or plain */ }
  }
  docStores.set(name, db);
  return db;
}

async function getVectorStore(name, dim = 768) {
  if (vectorStores.has(name)) return vectorStores.get(name);
  const dir = path.join(VECTOR_DIR, name);
  const inner = new FileStorageAdapter(dir);
  const adapter = await _wrapAdapterAsync(inner, dir);
  const store = new VectorStore(adapter, dim);
  if (typeof adapter.preloadAll === 'function') {
    try { await adapter.preloadAll(); } catch (e) { /* first run or plain */ }
  }
  vectorStores.set(name, store);
  return store;
}

async function persistDocStore(db) {
  await persistDocStore(db);
  const adapter = db._adapter;
  if (adapter && typeof adapter.persist === 'function') {
    await adapter.persist();
  }
}

async function persistVectorStore(store) {
  store.flush();
  const adapter = store._adapter;
  if (adapter && typeof adapter.persist === 'function') {
    await adapter.persist();
  }
}

function getBM25(name) {
  if (!bm25s.has(name)) bm25s.set(name, new BM25Index());
  return bm25s.get(name);
}

server.tool("rag_collection_setup", "Create a dual collection: structured document store (js-doc-store) + vector store (js-vector-store) + BM25 keyword index. Use this FIRST before indexing any documents for RAG.", {
  name: z.string().describe("Collection name, e.g. knowledge_base, faq, articles, support_docs."),
  description: z.string().describe("What this knowledge base contains."),
  fields: z.array(z.object({
    name: z.string(),
    type: z.enum(["string", "number", "boolean", "date", "array"]),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    default: z.any().optional()
  })).describe("Schema fields. MUST include: title (string), content (string, the full text for embedding), source (string, optional), tags (array, optional), createdAt (date)."),
  dimension: z.number().min(64).max(4096).default(768).describe("Embedding dimension. Must match your Ollama model. embeddinggemma = 768."),
  encrypted: z.boolean().optional().describe("If true, marks collection as encrypted (depends on ENCRYPTION_KEY env var).")
}, async (args) => {
  const db = await getDocStore(args.name);
  const schemas = db.collection("__schemas");
  schemas.insert({ name: args.name, description: args.description, fields: args.fields, createdAt: new Date().toISOString() });
  await persistDocStore(db);
  await getVectorStore(args.name, args.dimension);
  getBM25(args.name);
  return { content: [{ type: "text", text: JSON.stringify({ setup: args.name, fields: args.fields.map(f => f.name), dimension: args.dimension, engines: ["doc-store", "vector-store", "bm25"], nextStep: "Use rag_index_document to add content" }, null, 2) }] };
});

server.tool("rag_index_document", "Index a document for RAG: stores structured metadata in doc-store, generates embedding via Ollama, and indexes in vector-store + BM25. This is the PRIMARY way to add content to a RAG knowledge base.", {
  collection: z.string().describe("Collection name. Must have been set up with rag_collection_setup."),
  id: z.string().describe("Unique document ID."),
  content: z.string().describe("Full text content. This gets embedded for semantic search AND stored in the doc-store."),
  metadata: z.record(z.any()).optional().describe("Structured metadata: { title, source, author, tags, url, category, etc. }. These fields enable structured filtering later.")
}, async (args) => {
  const db = await getDocStore(args.collection);
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.collection });
  if (!schema) throw new Error(`Collection not set up. Call rag_collection_setup first.`);

  const docs = db.collection("documents");
  const docRecord = { _id: args.id, content: args.content, ...args.metadata, indexedAt: new Date().toISOString() };
  docs.insert(docRecord);
  await persistDocStore(db);

  const embedding = await generateEmbedding(args.content);
  const vStore = await getVectorStore(args.collection, embedding.length);
  vStore.set(args.collection, args.id, embedding, args.metadata);
  await persistVectorStore(vStore);

  const bm25 = getBM25(args.collection);
  bm25.addDocument(args.collection, args.id, args.content);

  return { content: [{ type: "text", text: JSON.stringify({ indexed: args.id, collection: args.collection, embeddingDim: embedding.length, contentLength: args.content.length, engines: ["doc-store", "vector-store", "bm25"] }, null, 2) }] };
});

server.tool("rag_search", "Search a RAG collection using semantic similarity (vector), keyword (BM25), or hybrid. Optionally filter by structured metadata first (doc-store) and then search within filtered results.", {
  collection: z.string().describe("Collection name."),
  query: z.string().describe("Query text. Gets embedded for vector search and used as keywords for BM25."),
  mode: z.enum(["vector", "bm25", "hybrid"]).default("hybrid").describe("Search mode: vector = semantic, bm25 = keyword, hybrid = both combined (RRF)."),
  limit: z.number().min(1).max(50).default(5).describe("Max results."),
  filter: z.record(z.any()).optional().describe("Structured filter using js-doc-store queries. Example: { category: salud } or { tags: { $_in: [ai, ml] } }. Applied BEFORE vector search if doc-store filter returns IDs.")
}, async (args) => {
  const db = await getDocStore(args.collection);
  const vStore = await getVectorStore(args.collection);
  const docs = db.collection("documents");
  let candidateIds = null;

  // Phase 1: structured filtering via doc-store if filter provided
  if (args.filter && Object.keys(args.filter).length > 0) {
    const filtered = docs.find(args.filter).toArray();
    candidateIds = filtered.map(d => d._id);
    if (candidateIds.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ results: [], note: "No documents matched the structured filter." }, null, 2) }] };
    }
  }

  // Phase 2: semantic/keyword search
  const qVec = await generateEmbedding(args.query);
  let results = [];

  if (args.mode === "vector") {
    const vecResults = vStore.search(args.collection, qVec, args.limit * 2);
    results = vecResults.map(r => ({ id: r.id, score: r.score, metadata: r.metadata }));
  } else if (args.mode === "bm25") {
    const bm25 = getBM25(args.collection);
    results = bm25.search(args.collection, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  } else {
    const bm25 = getBM25(args.collection);
    const hybrid = new HybridSearch(vStore, bm25, "rrf");
    results = hybrid.search(args.collection, qVec, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score, metadata: r.metadata }));
  }

  // Phase 3: intersect with candidateIds if filter was applied
  if (candidateIds) {
    const idSet = new Set(candidateIds);
    results = results.filter(r => idSet.has(r.id));
  }

  // Phase 4: enrich with full content from doc-store
  const enriched = [];
  for (const r of results.slice(0, args.limit)) {
    const doc = docs.findOne({ _id: r.id });
    if (doc) enriched.push({ id: r.id, score: r.score, content: doc.content, metadata: doc });
  }

  return { content: [{ type: "text", text: JSON.stringify({ query: args.query, mode: args.mode, filter: args.filter || null, results: enriched }, null, 2) }] };
});

server.tool("rag_context_for_prompt", "Retrieve RAG context formatted for injection into an LLM prompt. Searches the collection, then returns a formatted context block with source attribution. Use this to build RAG-powered responses.", {
  collection: z.string().describe("Collection name."),
  query: z.string().describe("User question or topic to find relevant context for."),
  mode: z.enum(["vector", "bm25", "hybrid"]).default("hybrid").describe("Search mode."),
  limit: z.number().min(1).max(20).default(5).describe("Max context chunks."),
  filter: z.record(z.any()).optional().describe("Structured filter via doc-store."),
  maxCharsPerChunk: z.number().min(100).max(10000).default(2000).describe("Max characters per context chunk. Truncates if longer.")
}, async (args) => {
  const db = await getDocStore(args.collection);
  const vStore = await getVectorStore(args.collection);
  const docs = db.collection("documents");
  let candidateIds = null;
  if (args.filter && Object.keys(args.filter).length > 0) {
    candidateIds = docs.find(args.filter).toArray().map(d => d._id);
    if (candidateIds.length === 0) return { content: [{ type: "text", text: JSON.stringify({ context: "", sources: [], note: "No matching documents." }, null, 2) }] };
  }

  const qVec = await generateEmbedding(args.query);
  let results = [];
  if (args.mode === "vector") {
    results = vStore.search(args.collection, qVec, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  } else if (args.mode === "bm25") {
    results = getBM25(args.collection).search(args.collection, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  } else {
    results = new HybridSearch(vStore, getBM25(args.collection), "rrf").search(args.collection, qVec, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  }
  if (candidateIds) results = results.filter(r => candidateIds.includes(r.id));

  const chunks = [];
  const sources = [];
  for (const r of results.slice(0, args.limit)) {
    const doc = docs.findOne({ _id: r.id });
    if (!doc) continue;
    let chunk = doc.content;
    if (chunk.length > args.maxCharsPerChunk) chunk = chunk.substring(0, args.maxCharsPerChunk) + "... [truncated]";
    chunks.push(`[Source: ${doc.title || doc.source || r.id} (relevance: ${(r.score * 100).toFixed(1)}%)]\n${chunk}`);
    sources.push({ id: r.id, title: doc.title || "", source: doc.source || "", score: r.score });
  }

  const contextText = chunks.join("\n\n---\n\n");
  const promptBlock = `Use the following retrieved context to answer the question. If the context does not contain the answer, say so honestly.\n\nContext:\n${contextText}\n\nQuestion: ${args.query}\n\nAnswer:`;

  return { content: [{ type: "text", text: JSON.stringify({ context: contextText, promptBlock, sources, chunkCount: chunks.length }, null, 2) }] };
});

server.tool("rag_pipeline", "Complete RAG pipeline in one call: setup (if needed) + search + format context for prompting. This is the ALL-IN-ONE tool for RAG. It checks if collection exists, searches, and returns ready-to-use prompt context.", {
  collection: z.string().describe("Collection name."),
  query: z.string().describe("User question."),
  mode: z.enum(["vector", "bm25", "hybrid"]).default("hybrid").describe("Search mode."),
  limit: z.number().min(1).max(20).default(5).describe("Max context chunks."),
  filter: z.record(z.any()).optional().describe("Structured filter."),
  maxCharsPerChunk: z.number().min(100).max(10000).default(2000).describe("Max chars per chunk.")
}, async (args) => {
  const db = await getDocStore(args.collection);
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.collection });
  if (!schema) throw new Error(`Collection ${args.collection} not set up. Call rag_collection_setup first.`);

  // Reuse rag_context_for_prompt logic inline
  const vStore = await getVectorStore(args.collection);
  const docs = db.collection("documents");
  let candidateIds = null;
  if (args.filter && Object.keys(args.filter).length > 0) {
    candidateIds = docs.find(args.filter).toArray().map(d => d._id);
    if (candidateIds.length === 0) return { content: [{ type: "text", text: JSON.stringify({ context: "", sources: [], note: "No matching documents." }, null, 2) }] };
  }

  const qVec = await generateEmbedding(args.query);
  let results = [];
  if (args.mode === "vector") {
    results = vStore.search(args.collection, qVec, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  } else if (args.mode === "bm25") {
    results = getBM25(args.collection).search(args.collection, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  } else {
    results = new HybridSearch(vStore, getBM25(args.collection), "rrf").search(args.collection, qVec, args.query, args.limit * 2).map(r => ({ id: r.id, score: r.score }));
  }
  if (candidateIds) results = results.filter(r => candidateIds.includes(r.id));

  const chunks = [];
  const sources = [];
  for (const r of results.slice(0, args.limit)) {
    const doc = docs.findOne({ _id: r.id });
    if (!doc) continue;
    let chunk = doc.content;
    if (chunk.length > args.maxCharsPerChunk) chunk = chunk.substring(0, args.maxCharsPerChunk) + "... [truncated]";
    chunks.push(`[Source: ${doc.title || doc.source || r.id} (relevance: ${(r.score * 100).toFixed(1)}%)]\n${chunk}`);
    sources.push({ id: r.id, title: doc.title || "", source: doc.source || "", score: r.score });
  }

  const contextText = chunks.join("\n\n---\n\n");
  const promptBlock = `Use the following retrieved context to answer the question. If the context does not contain the answer, say so honestly.\n\nContext:\n${contextText}\n\nQuestion: ${args.query}\n\nAnswer:`;

  return { content: [{ type: "text", text: JSON.stringify({ context: contextText, promptBlock, sources, chunkCount: chunks.length, collection: args.collection, mode: args.mode }, null, 2) }] };
});

server.tool("rag_collection_info", "Get stats about a RAG collection: document count, vector count, BM25 vocabulary size, sample documents, and schema fields.", {
  collection: z.string().describe("Collection name.")
}, async (args) => {
  const db = await getDocStore(args.collection);
  const schemas = db.collection("__schemas");
  const schema = schemas.findOne({ name: args.collection });
  const docs = db.collection("documents");
  const vStore = await getVectorStore(args.collection);
  const bm25 = getBM25(args.collection);
  const docIds = docs.find({}).toArray().map(d => d._id).slice(0, 10);
  return { content: [{ type: "text", text: JSON.stringify({ collection: args.collection, schema: schema ? { description: schema.description, fields: schema.fields.map(f => f.name) } : null, docCount: docs.find({}).count(), vectorCount: vStore.ids(args.collection).length, bm25Vocabulary: bm25.vocabularySize(args.collection), sampleIds: docIds }, null, 2) }] };
});

server.tool("rag_usage_guide", "Get the complete RAG usage guide. Call this when you need help with the RAG workflow or are unsure which tool to use.", {
  topic: z.string().optional().describe("Optional topic: setup, index, search, context, pipeline.")
}, async (args) => {
  const guide = `
# js-doc-store-rag - RAG Usage Guide

## Workflow
1. rag_collection_setup     - Create dual doc-store + vector-store collection
2. rag_index_document        - Add documents (auto-embeds via Ollama)
3. rag_search or rag_context_for_prompt - Retrieve relevant content
4. Feed context into LLM prompt for informed answers

## Key Concept
Every document lives in BOTH engines:
- Doc-store: structured metadata, filtering, CRUD
- Vector-store: semantic similarity via embeddings
- BM25: keyword search for exact terms

## When to use each tool

rag_collection_setup
- ALWAYS call first for a new collection.
- Defines schema fields (title, content, source, tags, etc.)

rag_index_document
- PRIMARY tool for adding knowledge.
- Provide: id, content (full text), metadata (structured)
- Automatically generates embedding and indexes in all 3 engines

rag_search
- When you need raw results with full document content.
- Supports structured filtering + semantic/keyword/hybrid search.

rag_context_for_prompt
- When you need formatted context to inject into an LLM prompt.
- Returns: context block, promptBlock, sources.

rag_pipeline
- ALL-IN-ONE: checks setup, searches, formats context.
- Use when you want the complete RAG result in one call.

## Filter examples
{ category: "salud" }
{ tags: { $_in: ["ai", "ml"] } }
{ author: "Mauricio", status: "published" }
{ createdAt: { $_gte: "2024-01-01" } }

## Search modes
- vector: best for conceptual queries
- bm25: best for exact terms
- hybrid: best overall (default)
`;
  if (args.topic) {
    const section = guide.split("## " + args.topic.charAt(0).toUpperCase() + args.topic.slice(1))[1];
    if (section) return { content: [{ type: "text", text: "## " + args.topic.charAt(0).toUpperCase() + args.topic.slice(1) + section.split("##")[0] }] };
  }
  return { content: [{ type: "text", text: guide }] };
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("js-doc-store-rag MCP Server started on stdio");
  console.error("Tools: rag_collection_setup, rag_index_document, rag_search,");
  console.error("         rag_context_for_prompt, rag_pipeline, rag_collection_info,");
  console.error("         rag_usage_guide");
});
