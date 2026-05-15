const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const { DocStore, FileStorageAdapter, EncryptedAdapter, GitStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));

const DATA_DIR = path.join(__dirname, "test-git-data-outside");
if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true });

(async () => {
  const inner = new FileStorageAdapter(DATA_DIR);
  const enc = await EncryptedAdapter.create(inner, "test-secret-key-123");
  const adapter = new GitStorageAdapter(enc, { repoPath: DATA_DIR, commitMessage: "Batch test", batchIntervalMs: 3000 });
  const db = new DocStore(adapter);
  await adapter.preloadAll();

  const schemas = db.collection("__schemas");
  schemas.insert({ name: "batch_test", description: "Batch interval test", collections: [{ name: "items", fields: [{ name: "title", type: "string", required: true }] }], createdAt: new Date().toISOString() });

  console.log("Before flush: _timer =", adapter._timer ? "SET" : "NULL", "_dirty =", adapter._dirty);
  db.flush();
  console.log("After flush: _timer =", adapter._timer ? "SET" : "NULL", "_dirty =", adapter._dirty);
  await adapter.persist();
  console.log("After persist: _timer =", adapter._timer ? "SET" : "NULL", "_dirty =", adapter._dirty);

  let log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
  console.log("Log immediately after persist:");
  console.log(log);
})();
