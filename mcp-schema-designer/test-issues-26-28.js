// Regression tests for issues #26, #27, #28
// Validates the three fixes applied to schema-api-auth-server.js,
// schema-api-server.js, and schema-api-prod.js.

const http = require("http");
const assert = require("assert");

const AUTH_PORT = 3999;
const PROD_PORT = 4000;

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const opts = { hostname: "localhost", port, path, method, headers: { "Content-Type": "application/json", ...headers } };
    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log("\n=== Issue #26: auth check before schema lookup ===");

  // POST without token to a NONEXISTENT schema → should be 401 (was 404 before)
  const r1 = await request(AUTH_PORT, "POST", "/api/nonexistent-schema/posts", { title: "x" });
  assert.strictEqual(r1.status, 401, `#26: unauth POST to nonexistent schema should be 401, got ${r1.status}`);
  assert(r1.body.error && r1.body.error.includes("Authentication"), `#26: error message should mention auth`);
  console.log("OK  : #26 unauth POST to nonexistent schema → 401");

  // POST without token to an EXISTING schema → also 401
  const r2 = await request(AUTH_PORT, "POST", "/api/blog_cms/posts", { title: "x" });
  assert.strictEqual(r2.status, 401, `#26: unauth POST to existing schema should be 401, got ${r2.status}`);
  console.log("OK  : #26 unauth POST to existing schema → 401");

  console.log("\n=== Issue #27: ref integrity validation ===");

  // Register and login to get a token
  await request(AUTH_PORT, "POST", "/auth/register", { email: "ref-test@test.com", password: "testpass123", profile: {} });
  const login = await request(AUTH_PORT, "POST", "/auth/login", { email: "ref-test@test.com", password: "testpass123" });
  const token = login.body.token;
  assert(token, "Login should return token");

  // POST with invalid authorId (ref) → 400
  const r3 = await request(AUTH_PORT, "POST", "/api/blog_cms/posts", {
    title: "Ref Test", slug: "ref-test", content: "body", authorId: "this-does-not-exist"
  }, { "Authorization": `Bearer ${token}` });
  assert.strictEqual(r3.status, 400, `#27: invalid ref should be 400, got ${r3.status}`);
  assert(r3.body.error && r3.body.errors && r3.body.errors.some(e => e.includes("Reference not found")), `#27: error should mention ref not found`);
  console.log("OK  : #27 invalid ref authorId → 400 with ref error");

  // POST with valid authorId → 201
  // First insert an author (use unique email to avoid conflict)
  const uniqueEmail = `author-${Date.now()}@test.com`;
  const author = await request(AUTH_PORT, "POST", "/api/blog_cms/authors", {
    name: "Test Author", email: uniqueEmail, bio: "bio"
  }, { "Authorization": `Bearer ${token}` });
  if (author.status !== 201) {
    console.log("Author insert failed:", author.status, author.body);
  }
  assert.strictEqual(author.status, 201, "Author insert should succeed");
  const authorId = author.body.inserted._id;

  const r4 = await request(AUTH_PORT, "POST", "/api/blog_cms/posts", {
    title: "Ref Test Valid", slug: `ref-valid-${Date.now()}`, content: "body", authorId
  }, { "Authorization": `Bearer ${token}` });
  if (r4.status !== 201) {
    console.log("Post insert failed:", r4.status, r4.body);
  }
  assert.strictEqual(r4.status, 201, `#27: valid ref should be 201, got ${r4.status}`);
  console.log("OK  : #27 valid ref authorId → 201");

  console.log("\n=== Issue #28: MongoDB operators in PATCH ===");

  // Insert a post via prod API (no auth needed)
  // cms_blog schema uses 'post' collection, 'user' for authors, 'author' field
  const now = new Date().toISOString();
  const prodPost = await request(PROD_PORT, "POST", "/api/cms_blog/post", {
    title: "Op Test", slug: `op-test-${Date.now()}`, body: "body for operator test",
    author: "mp7f5jmz-9f0up6-2", status: "draft", createdAt: now, updatedAt: now
  });
  if (prodPost.status !== 201) {
    console.log("Prod insert failed:", prodPost.status, prodPost.body);
  }
  assert.strictEqual(prodPost.status, 201, "Prod insert should succeed");
  const postId = prodPost.body.inserted._id;

  // PATCH with $inc → should increment views (default 0 → 1)
  const r5 = await request(PROD_PORT, "PATCH", `/api/cms_blog/post/${postId}`, { $inc: { views: 1 } });
  assert.strictEqual(r5.status, 200, `#28: $inc should succeed, got ${r5.status}`);
  assert.strictEqual(r5.body.updated.views, 1, `#28: views should be 1 after $inc`);
  console.log("OK  : #28 PATCH with $inc → views = 1");

  // PATCH plain fields → should wrap in $set and work
  const r6 = await request(PROD_PORT, "PATCH", `/api/cms_blog/post/${postId}`, { status: "published" });
  assert.strictEqual(r6.status, 200, `#28: plain PATCH should succeed, got ${r6.status}`);
  assert.strictEqual(r6.body.updated.status, "published", `#28: status should be published`);
  assert.strictEqual(r6.body.updated.views, 1, `#28: views should still be 1 after plain PATCH`);
  console.log("OK  : #28 PATCH plain fields → status published, views unchanged");

  // PUT with $unset → should remove a field
  const r7 = await request(PROD_PORT, "PUT", `/api/cms_blog/post/${postId}`, { $unset: { excerpt: 1 } });
  assert.strictEqual(r7.status, 200, `#28: $unset should succeed, got ${r7.status}`);
  assert(r7.body.updated.excerpt === undefined, `#28: excerpt should be removed after $unset`);
  console.log("OK  : #28 PUT with $unset → excerpt removed");

  console.log("\nAll assertions passed.");
  process.exit(0);
})().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(1);
});
