# js-doc-store-headless

Headless CMS API powered by [js-doc-store](https://github.com/MauricioPerera/js-doc-store).
Zero-dependency document database with MongoDB-style queries, JWT authentication, dynamic schema generation, and portable deployment packages.

## Features

- **Zero-dependency core**: The database engine itself has zero npm dependencies
- **Dynamic schemas**: Define collections, fields, types, indexes, and relationships on the fly via MCP or REST
- **REST API**: Full CRUD endpoints generated automatically from schemas
- **JWT Authentication**: Built-in auth with register, login, logout, role-based access
- **MCP Server**: One Model Context Protocol server for Codex/Claude integration
- **Portable deploy**: Export schemas + data to a JSON file, deploy anywhere
- **Auto-import**: Production server auto-loads exported schemas on startup
- **MongoDB-style queries**: $eq, $gt, $gte, $lt, $lte, $in, $regex, $and, $or, etc.
- **Relationships**: Reference fields (ref) between collections with automatic linking
- **Validation**: Schema-enforced required fields, unique constraints, type checking

## Workflow: Local Development -> Production Deploy

### 1. Local Development (with MCP)

Use the MCP Schema Designer to define your CMS architecture:

```bash
# Start MCP server
npx js-doc-store-headless mcp

# Then in Codex/Claude, the LLM can:
# 1. schema_define -> design your blog_cms, task_manager, ecom_store...
# 2. schema_instantiate -> create real collections
# 3. schema_insert / schema_seed -> add content
# 4. schema_query -> test queries
```

### 2. Export Your Schema

```bash
npx js-doc-store-headless export --schema blog_cms --output ./exports
```

This creates `exports/blog_cms.export.json` containing:
- Full schema definition (collections, fields, indexes, relationships)
- All documents (posts, authors, categories, etc.)
- Metadata (version, export timestamp)

### 3. Deploy to Production

```bash
npx js-doc-store-headless deploy --schema blog_cms --output ./deploy
```

This generates a portable deployment package:
```
deploy/
  server.js          # Production API server (auto-imports exports/)
  js-doc-store.js    # Database engine
  schema-portable.js # Import logic
  exports/
    blog_cms.export.json  # Schema + data
  package.json
  .env.example
  README.md
```

### 4. Run Production API

```bash
cd deploy
node server.js
```

The server automatically imports the schema and data from `exports/` on startup. The API is now live at `http://localhost:3000`.

### 5. Connect Frontend

```javascript
// List all posts
fetch('http://localhost:3000/api/blog_cms/posts')
  .then(r => r.json())
  .then(data => console.log(data.docs));

// Filter posts
fetch('http://localhost:3000/api/blog_cms/posts?published=true&__sort={"createdAt":-1}')

// Create post
fetch('http://localhost:3000/api/blog_cms/posts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Hello', slug: 'hello', content: 'World!' })
});
```

## CLI Commands

```bash
# Development
npx js-doc-store-headless mcp              # Start MCP Schema Designer
npx js-doc-store-headless api              # Start API with JWT auth
npx js-doc-store-headless api:basic        # Start API without auth
npx js-doc-store-headless api:prod         # Start production API (auto-import)

# Data management
npx js-doc-store-headless list             # List all schemas
npx js-doc-store-headless export --schema blog_cms --output ./exports
npx js-doc-store-headless import --schema blog_cms --output ./exports

# Deployment
npx js-doc-store-headless deploy --schema blog_cms --output ./deploy

# Help
npx js-doc-store-headless help
```

## REST API Endpoints

### Public (Auth API)
- `POST /auth/register` - Create account
- `POST /auth/login` - Get JWT token
- `GET /auth/me` - Current user profile
- `POST /auth/logout` - Invalidate token

### Public (Data)
- `GET /api` - List all schemas
- `GET /api/:schema` - Schema architecture detail
- `GET /api/:schema/:collection` - List documents (with filters)
- `GET /api/:schema/:collection/:id` - Get single document

### Protected (requires Bearer token)
- `POST /api/:schema/:collection` - Create document
- `PUT /api/:schema/:collection/:id` - Update document
- `DELETE /api/:schema/:collection/:id` - Delete document

### Admin
- `GET /admin/users` - List all users (admin role required)

## MCP Schema Designer Tools

| Tool | Purpose |
|------|---------|
| `schema_define` | Design a database architecture |
| `schema_exists` | Check if schema exists (with skill context) |
| `schema_instantiate` | Create real collections from schema |
| `schema_list` | List all schemas with architecture details |
| `schema_insert` | Insert with validation |
| `schema_query` | Query with filters, sort, pagination |
| `schema_update` | Update documents |
| `schema_delete` | Delete documents |
| `schema_seed` | Generate sample data |

## Schema Definition Format

```json
{
  "name": "task_manager",
  "description": "Task management system",
  "collections": [
    {
      "name": "users",
      "fields": [
        { "name": "name", "type": "string", "required": true },
        { "name": "email", "type": "string", "required": true, "unique": true },
        { "name": "role", "type": "string", "default": "user" }
      ],
      "indexes": [{ "field": "email", "unique": true }]
    },
    {
      "name": "tasks",
      "fields": [
        { "name": "title", "type": "string", "required": true },
        { "name": "assigneeId", "type": "ref", "refCollection": "users" },
        { "name": "priority", "type": "number", "default": 1 },
        { "name": "status", "type": "string", "default": "todo" }
      ]
    }
  ]
}
```

## Field Types

| Type | Description |
|------|-------------|
| `string` | Text values |
| `number` | Numeric values |
| `boolean` | true/false |
| `date` | ISO 8601 dates |
| `array` | Arrays of any values |
| `object` | Nested objects |
| `ref` | Reference to another collection's `_id` |

## Query Operators

- `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
- `$in`, `$nin`, `$exists`, `$regex`
- `$and`, `$or`, `$not`
- `$contains` (arrays), `$size` (arrays)

## Portable Export Format

Exported schemas are pure JSON files containing everything needed to recreate the database:

```json
{
  "name": "blog_cms",
  "version": "1.0.0",
  "exportedAt": "2026-05-15T05:20:01.656Z",
  "collections": [
    {
      "name": "posts",
      "definition": { "fields": [...], "indexes": [...] },
      "documents": [{ "title": "Hello", "_id": "..." }],
      "documentCount": 42
    }
  ]
}
```

These files can be:
- Committed to Git
- Shared between teams
- Deployed to multiple environments
- Versioned alongside your frontend code

## Authentication

Uses PBKDF2-SHA256 password hashing and JWT tokens. Configure via environment variables:

```bash
JWT_SECRET=your-super-secret-key
PORT=3000
DATA_DIR=./data
EXPORT_DIR=./exports
```

## Data Storage

All data persists to the filesystem in JSON files:
- `schema-designer-data/__schemas.docs.json` - Schema definitions
- `schema-designer-data/<collection>.docs.json` - Collection data
- `schema-designer-data/<collection>.meta.json` - Collection metadata

## Integration with Codex/Claude

Add the MCP servers to your Codex configuration:

```bash
codex mcp add js-doc-store-schema-designer -- node /path/to/schema-designer-server.js
```

Then your LLM can:
- Design database architectures on demand
- Validate data against schemas
- Query with MongoDB-style filters
- Export and deploy to production

## License

MIT
