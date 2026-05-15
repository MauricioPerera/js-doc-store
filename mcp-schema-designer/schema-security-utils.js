// Helpers for security-related env-var setup errors and tool descriptions.

const AUTH_SETUP_HELP =
  'AUTH_SECRET environment variable is not set on the MCP server, so auth tools are disabled. ' +
  'Restart the server with AUTH_SECRET to enable auth_register, auth_login, auth_assign_role, ' +
  'audit_query (filtered), secure_delete, and rotate_encryption_key. ' +
  'Example: AUTH_SECRET="$(openssl rand -hex 32)" node schema-designer-server.js';

const ENCRYPTION_SETUP_HELP =
  'ENCRYPTION_KEY environment variable is not set on the MCP server, so field encryption is disabled. ' +
  'Restart the server with ENCRYPTION_KEY (>= 8 chars) to enable field_encrypt, field_decrypt, ' +
  'rotate_encryption_key, and the EncryptedAdapter for at-rest data encryption. ' +
  'Example: ENCRYPTION_KEY="$(openssl rand -hex 32)" node schema-designer-server.js';

function requireAuthSecret(authInstance) {
  if (!authInstance) throw new Error(AUTH_SETUP_HELP);
  return authInstance;
}

function requireEncryptionKey(key) {
  if (!key) throw new Error(ENCRYPTION_SETUP_HELP);
  return key;
}

module.exports = {
  AUTH_SETUP_HELP,
  ENCRYPTION_SETUP_HELP,
  requireAuthSecret,
  requireEncryptionKey,
};
