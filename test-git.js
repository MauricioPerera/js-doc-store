const path = require("path");
const { DocStore, FileStorageAdapter, EncryptedAdapter, GitStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const DATA_DIR = path.join(__dirname, "mcp-schema-designer", "schema-designer-data");

async function main() {
  const fs = require("fs");
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });

  const inner = new FileStorageAdapter(DATA_DIR);
  const enc = await EncryptedAdapter.create(inner, "test-secret-key-123");
  const adapter = new GitStorageAdapter(enc, { repoPath: DATA_DIR, commitMessage: "Auto-commit via MCP" });
  const db = new DocStore(adapter);
  await adapter.preloadAll();

  const schemas = db.collection("__schemas");
  schemas.insert({ name: "git_test", description: "Git storage test", collections: [ { name: "items", fields: [ { name: "title", type: "string", required: true } ] } ], createdAt: new Date().toISOString() });

  const col = db.collection("items");
  col.insert({ title: "Hello Git" });
  db.flush();
  await adapter.persist();

  console.log("Inserted and persisted");

  const inner2 = new FileStorageAdapter(DATA_DIR);
  const enc2 = await EncryptedAdapter.create(inner2, "test-secret-key-123");
  const adapter2 = new GitStorageAdapter(enc2, { repoPath: DATA_DIR, commitMessage: "Auto-commit via MCP" });
  const db2 = new DocStore(adapter2);
  await adapter2.preloadAll();

  const s = db2.collection("__schemas").findOne({ name: "git_test" });
  console.log("Reopen schema exists:", !!s);

  const docs = db2.collection("items").find({}).toArray();
  console.log("Reopen docs:", docs.length, "first title =", docs[0]?.title);

  const { execSync } = require("child_process");
  try {
    const log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
    console.log("Git commits:");
    console.log(log);
  } catch (e) {
    console.log("No git log:", e.message);
  }
}

main().catch(console.error);
