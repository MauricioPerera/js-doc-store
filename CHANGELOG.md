# Changelog

## 1.2.1 - 2026-07-06

### Fixed
- **Security**: `Auth._verifyPassword` now compares password hashes in constant time. It previously used `===` on the base64-encoded hash, which short-circuits on the first differing byte (a timing side-channel on matching-prefix length). Added a portable, zero-dependency `_constantTimeEqual` (XOR accumulate, no early exit). Verification behavior is unchanged; regression test in `test-timing-safe.js`. Reported by an external audit of a downstream vendor.

## 1.0.1 - 2026-05-15

### Fixed
- **Security**: Replaced string-interpolated `execSync` with `execFileSync` + args array in `GitStorageAdapter._doCommit` to prevent shell injection via `commitMessage`, `authorName`, `authorEmail`, `pushRemote`, or `pushBranch`.
- **Security**: Removed orphan encrypted test blobs from `test-git-data-outside/`.
- **Correctness**: Fixed misleading comment in `js-doc-store.js` — update without `$` operators performs a partial merge (`Object.assign`), not a full replacement.
- **MCP usability**: Removed references to non-existent `mcp-memory-server.js` from `bin/cli.js` and `package.json`.
- **MCP BM25 persistence**: `rag-server.js` now persists BM25 indexes via `exportState()` after each document index operation.
- **Bundled library sync**: Copied updated `js-doc-store.js` (shell-injection fix + comment fix) into `mcp-rag-engine/`.

## 1.0.0 - 2026-05-01

### Added
- Initial release: `js-doc-store` core, `mcp-schema-designer`, `mcp-rag-engine`, REST API servers, JWT auth, RBAC, audit logging, portable deploy, encryption, and Git-backed storage adapters.
