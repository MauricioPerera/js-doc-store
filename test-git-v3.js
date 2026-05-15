const path = require("path");
const { DocStore, FileStorageAdapter, EncryptedAdapter, GitStorageAdapter } = require(path.join(__dirname, "js-doc-store.js"));
const DATA_DIR = path.join(__dirname, "test-git-data-outside");
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
  
  db.flush();
  await adapter.persist();

  const { execSync } = require("child_process");
  let log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
  const commitsBefore = log.trim().split("\n").filter(l => l.includes("Batch test")).length;
  console.log("Commits immediately after persist:", commitsBefore);

  console.log("Waiting 4 seconds...");
  await sleep(4000);

  log = execSync('git -C "' + DATA_DIR + '" log --oneline', { encoding: "utf-8" });
  const commitsAfter = log.trim().split("\n").filter(l => l.includes("Batch test")).length;
  console.log("Commits after interval:", commitsAfter);
  console.log("Batch interval test:", commitsBefore === 0 && commitsAfter === 1 ? "PASS" : "FAIL");

  console.log("\n=== TEST: Auto-push (no remote, should fail gracefully) ===");
  const DATA_DIR2 = path.join(__dirname, "test-git-data-push");
  if (fs.existsSync(DATA_DIR2)) fs.rmSync(DATA_DIR2, { recursive: true });

  const inner2 = new FileStorageAdapter(DATA_DIR2);
  const enc2 = await EncryptedAdapter.create(inner2, "test-secret-key-123");
  const adapter2 = new GitStorageAdapter(enc2, { repoPath: DATA_DIR2, commitMessage: "Push test", autoPush: true, pushRemote: "origin", pushBranch: "master" });
  const db2 = new DocStore(adapter2);
  await adapter2.preloadAll();

  db2.collection("__schemas").insert({ name: "push_test", description: "Push test", collections: [], createdAt: new Date().toISOString() });
  db2.flush();
  await adapter2.persist();

  log = execSync('git -C "' + DATA_DIR2 + '" log --oneline', { encoding: "utf-8" });
  console.log("Commits exist:", log.includes("Push test") ? "PASS" : "FAIL");
  console.log("Auto-push did not crash: PASS");

  // Cleanup
  fs.rmSync(DATA_DIR, { recursive: true });
  fs.rmSync(DATA_DIR2, { recursive: true });

  console.log("\nAll tests completed.");
}

main().catch(console.error);
