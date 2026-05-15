const path = require("path");
const { DocStore, FileStorageAdapter, EncryptedAdapter, GitStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const DATA_DIR = path.join(__dirname, "mcp-schema-designer", "schema-designer-data");
const fs = require("fs");

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });

  console.log("\n=== TEST: Batch interval (3s) ===");
  const inner = new FileStorageAdapter(DATA_DIR);
  const enc = await EncryptedAdapter.create(inner, "test-secret-key-123");
  const adapter = new GitStorageAdapter(enc, { repoPath: DATA_DIR, commitMessage: "Batch test", batchIntervalMs: 3000 });
  const db = new DocStore(adapter);
  await adapter.preloadAll();

  const schemas = db.collection("__schemas");
  schemas.insert({ name: "batch_test", description: "Batch interval test", collections: [ { name: "items", fields: [ { name: "title", type: "string", required: true } ] } ], createdAt: new Date().toISOString() });
  
  console.log("Before flush: _timer =", adapter._timer, "_dirty =", adapter._dirty);
  db.flush();
  console.log("After flush: _timer =", adapter._timer, "_dirty =", adapter._dirty);
  await adapter.persist();
  console.log("After persist: _timer =", adapter._timer, "_dirty =", adapter._dirty);

  const { execSync } = require("child_process");
  let log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
  console.log("Commits immediately after persist:", log.trim().split("\n").length);

  console.log("Waiting 4 seconds...");
  await sleep(4000);

  log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
  console.log("Commits after interval:", log.trim().split("\n").length);
  console.log("Log:\n" + log);
}

main().catch(console.error);
