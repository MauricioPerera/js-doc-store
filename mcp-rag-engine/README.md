# js-doc-store-rag

RAG engine combining [js-doc-store](https://github.com/MauricioPerera/js-doc-store) (structured documents) and [js-vector-store](https://github.com/MauricioPerera/js-vector-store) (semantic search).

Hybrid search with structured filtering + Ollama embeddings for Retrieval-Augmented Generation.

## Features

- **Dual storage**: Every document lives in BOTH a document database (metadata) AND a vector store (embeddings)
- **Hybrid search**: Semantic similarity (cosine) + keyword (BM25) combined via RRF
- **Structured filtering**: Filter by metadata fields BEFORE semantic search (category, tags, date, etc.)
- **Local embeddings**: Ollama (embeddinggemma, nomic-embed-text, etc.) — no API keys
- **MCP Server**: 7 tools for Codex/Claude LLM integration
- **REST API**: Index and search via HTTP
- **Context formatting**: Automatically formats retrieved chunks for LLM prompting

## Quick Start

### Prerequisites

- [Ollama](https://ollama.com) running with an embedding model: `ollama pull embeddinggemma`

### Start the API

```bash
npm install js-doc-store-rag
npx js-doc-store-rag api
```

### Setup collection

```bash
curl -X POST http://localhost:4000/collections/kb \
  -H "Content-Type: application/json" \
  -d '{"id":"doc-1","content":"La IA revoluciona la medicina...","metadata":{"title":"IA en Salud","category":"salud"}}'
```

### Search with RAG

```bash
# Hybrid search with structured filter
curl "http://localhost:4000/collections/kb?q=diagnostico%20medico%20IA&mode=hybrid&limit=5"
```

## MCP Tools

| Tool | Purpose |
|------|---------|
| `rag_collection_setup` | Create dual doc-store + vector-store collection |
| `rag_index_document` | Index document (auto-embeds via Ollama) |
| `rag_search` | Search with optional structured filtering |
| `rag_context_for_prompt` | Format results as LLM-ready context |
| `rag_pipeline` | All-in-one: search + format context |
| `rag_collection_info` | Collection stats |
| `rag_usage_guide` | Usage guide for LLMs |

## Architecture

```
Document Input
    |
    v
[DocStore] --------> Structured metadata (filtering, CRUD)
    |
    v
[Ollama] --embedding--> [VectorStore] --cosine sim--> Results
    |                      ^
    v                      |
[BM25Index] --keywords----> [HybridSearch] --RRF--> Final Ranking
    |
    v
Context Formatter --> LLM Prompt
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/collections/:name` | Index document |
| GET | `/collections/:name?q=...` | Search (vector/bm25/hybrid) |
| GET | `/collections/:name/:id` | Get document |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API URL |
| `OLLAMA_MODEL` | `embeddinggemma:latest` | Embedding model |
| `PORT` | `4000` | API server port |
| `DATA_DIR` | `./rag-data` | Doc-store data |
| `VECTOR_DIR` | `./rag-vectors` | Vector-store data |

## Integration with Codex/Claude

```bash
codex mcp add js-doc-store-rag -- node /path/to/rag-server.js
```

Then the LLM can:
- Set up knowledge bases with structured schemas
- Index documents with automatic embedding generation
- Search with metadata filtering + semantic similarity
- Retrieve formatted context for informed responses

## License

MIT
