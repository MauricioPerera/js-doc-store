const http = require("http");
const url = require("url");
const path = require("path");

const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const { VectorStore, BM25Index, HybridSearch, FileStorageAdapter: VectorFileAdapter } = require(path.join(__dirname, "js-vector-store.js"));

const PORT = process.env.PORT || 4000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "rag-data");
const VECTOR_DIR = process.env.VECTOR_DIR || path.join(__dirname, "rag-vectors");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "embeddinggemma:latest";

async function generateEmbedding(text) {
  const res = await fetch(OLLAMA_HOST + "/api/embeddings", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  return (await res.json()).embedding;
}

function getDocStore(name) {
  return new DocStore(new FileStorageAdapter(path.join(DATA_DIR, name)));
}

function getVectorStore(name, dim = 768) {
  return new VectorStore(new VectorFileAdapter(path.join(VECTOR_DIR, name)), dim);
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data, null, 2));
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
    res.writeHead(200, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  try {
    if (pathname === "/health") return send(res, 200, { status: "ok", api: "rag-engine", ollama: OLLAMA_MODEL });

    const m = pathname.match(/^\/collections\/([^\/]+)(?:\/([^\/]+))?$/);
    if (!m) return send(res, 404, { error: "Not found. Use /collections/:name or /collections/:name/:id" });

    const [, colName, docId] = m;
    const db = getDocStore(colName);
    const docs = db.collection("documents");
    const schemas = db.collection("__schemas");

    // POST /collections/:name - index document
    if (req.method === "POST" && !docId) {
      const body = await readBody(req);
      const docRecord = { _id: body.id, content: body.content, ...body.metadata, indexedAt: new Date().toISOString() };
      docs.insert(docRecord);
      db.flush();
      const embedding = await generateEmbedding(body.content);
      const vStore = getVectorStore(colName, embedding.length);
      vStore.set(colName, body.id, embedding, body.metadata);
      vStore.flush();
      const bm25 = new BM25Index();
      bm25.addDocument(colName, body.id, body.content);
      return send(res, 201, { indexed: body.id, embeddingDim: embedding.length });
    }

    // GET /collections/:name - search or list
    if (req.method === "GET" && !docId) {
      const q = query.q;
      if (!q) {
        const all = docs.find({}).toArray();
        return send(res, 200, { collection: colName, count: all.length, docs: all.map(d => ({ id: d._id, title: d.title || "", source: d.source || "" })) });
      }
      const qVec = await generateEmbedding(q);
      const vStore = getVectorStore(colName, qVec.length);
      const mode = query.mode || "hybrid";
      const limit = Number(query.limit) || 5;
      let results = [];
      if (mode === "vector") {
        results = vStore.search(colName, qVec, limit).map(r => ({ id: r.id, score: r.score }));
      } else if (mode === "bm25") {
        const bm25 = new BM25Index();
        results = bm25.search(colName, q, limit).map(r => ({ id: r.id, score: r.score }));
      } else {
        const bm25 = new BM25Index();
        results = new HybridSearch(vStore, bm25, "rrf").search(colName, qVec, q, limit).map(r => ({ id: r.id, score: r.score }));
      }
      const enriched = [];
      for (const r of results) {
        const doc = docs.findOne({ _id: r.id });
        if (doc) enriched.push({ id: r.id, score: r.score, content: doc.content.substring(0, 500), metadata: doc });
      }
      return send(res, 200, { collection: colName, query: q, mode, results: enriched });
    }

    // GET /collections/:name/:id
    if (req.method === "GET" && docId) {
      const doc = docs.findOne({ _id: docId });
      if (!doc) return send(res, 404, { error: "Not found" });
      return send(res, 200, doc);
    }

    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error("API Error:", err.message);
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`RAG Engine API running on http://localhost:${PORT}`);
  console.log("POST /collections/:name     - Index document");
  console.log("GET  /collections/:name?q=... - Search (mode=vector|bm25|hybrid)");
  console.log("GET  /collections/:name/:id   - Get document");
});
