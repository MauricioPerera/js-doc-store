#!/bin/bash
# Wrapper for schema-designer-server.js
# Ensures AUTH_SECRET and ENCRYPTION_KEY are available as environment variables.
#
# Usage:
#   chmod +x schema-designer-server-wrapper.sh
#   ./schema-designer-server-wrapper.sh
#
# Or add to Claude Code MCP config:
#   claude mcp add schema-designer -- ./schema-designer-server-wrapper.sh
#
# The wrapper first checks if AUTH_SECRET and ENCRYPTION_KEY are already set
# in the parent environment. If not, it generates cryptographically secure
# random values automatically. These are NOT persisted between runs — set them
# explicitly in your shell or CI if you need stable tokens across restarts.
#
# Why this wrapper exists:
# The Claude Code stdio MCP harness does not reliably pass `env` keys from
# `.claude.json` / `claude mcp add-json` to the spawned process on Linux.
# This wrapper guarantees the variables are exported before Node starts.

if [ -z "$AUTH_SECRET" ]; then
  export AUTH_SECRET="$(openssl rand -hex 32)"
  echo "[wrapper] Generated AUTH_SECRET (set explicitly to reuse across restarts)" >&2
fi

if [ -z "$ENCRYPTION_KEY" ]; then
  export ENCRYPTION_KEY="$(openssl rand -hex 32)"
  echo "[wrapper] Generated ENCRYPTION_KEY (set explicitly to reuse across restarts)" >&2
fi

exec node "$(dirname "$0")/schema-designer-server.js"
