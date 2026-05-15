const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod/v4");
const path = require("path");

const { DocStore, FileStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const db = new DocStore(new FileStorageAdapter(path.join(__dirname, "mcp-memory-data")));

const server = new McpServer(
  { name: "js-doc-store-memory", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.tool("memory_store", "Store a document in a named collection. Returns the created document with its _id.", {
  collection: z.string().describe("Collection name (e.g. notes, tasks, facts)"),
  doc: z.record(z.any()).describe("Document to store. Any JSON object.")
}, async (args) => {
  const col = db.collection(args.collection);
  const inserted = col.insert(args.doc);
  db.flush();
  return { content: [{ type: "text", text: JSON.stringify({ stored: inserted }, null, 2) }] };
});

server.tool("memory_search", "Search documents in a collection using MongoDB-style queries.", {
  collection: z.string().describe("Collection name"),
  filter: z.record(z.any()).describe("MongoDB-style query filter"),
  sort: z.record(z.any()).optional().describe("Optional sort, e.g. { age: -1 }"),
  limit: z.number().optional().describe("Optional limit")
}, async (args) => {
  const col = db.collection(args.collection);
  let cursor = col.find(args.filter);
  if (args.sort) cursor = cursor.sort(args.sort);
  if (args.limit) cursor = cursor.limit(args.limit);
  const results = cursor.toArray();
  return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
});

server.tool("memory_update", "Update documents in a collection matching a filter.", {
  collection: z.string().describe("Collection name"),
  filter: z.record(z.any()).describe("Filter to match documents to update"),
  update: z.record(z.any()).describe("Update object, e.g. { $_set: { field: value } }")
}, async (args) => {
  const col = db.collection(args.collection);
  col.update(args.filter, args.update);
  db.flush();
  return { content: [{ type: "text", text: JSON.stringify({ updated: true }, null, 2) }] };
});

server.tool("memory_delete", "Delete documents in a collection matching a filter.", {
  collection: z.string().describe("Collection name"),
  filter: z.record(z.any()).describe("Filter to match documents to delete")
}, async (args) => {
  const col = db.collection(args.collection);
  col.remove(args.filter);
  db.flush();
  return { content: [{ type: "text", text: JSON.stringify({ deleted: true }, null, 2) }] };
});

server.tool("memory_list", "List all documents in a collection.", {
  collection: z.string().describe("Collection name"),
  limit: z.number().optional().describe("Optional limit")
}, async (args) => {
  const col = db.collection(args.collection);
  let cursor = col.find({});
  if (args.limit) cursor = cursor.limit(args.limit);
  const results = cursor.toArray();
  return { content: [{ type: "text", text: JSON.stringify({ results }, null, 2) }] };
});

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("MCP Memory Server (js-doc-store) started on stdio");
});
