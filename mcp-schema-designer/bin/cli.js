const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log('js-doc-store-headless CLI');
  console.log('');
  console.log('Usage: js-doc-store-headless <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  api           Start the headless REST API server (with JWT auth)');
  console.log('  api:basic     Start the basic REST API server (no auth)');
  console.log('  api:prod      Start the production API server (auto-imports exports/)');
  console.log('  mcp           Start the MCP Schema Designer server');
  console.log('  mcp:memory    Start the MCP Memory server');
  console.log('  list          List defined schemas in the local database');
  console.log('  export        Export a schema to a portable JSON file');
  console.log('  import        Import a schema from a portable JSON file');
  console.log('  deploy        Create a production deployment package');
  console.log('');
  console.log('Options:');
  console.log('  --port, -p    Port for API server (default: 3000)');
  console.log('  --data, -d    Data directory (default: ./schema-designer-data)');
  console.log('  --secret, -s  JWT secret (default: change-me-in-production)');
  console.log('  --schema      Schema name (for export/import)');
  console.log('  --output, -o  Output directory (for export/deploy)');
  console.log('  --prefix      Collection prefix (for import)');
  console.log('');
  console.log('Examples:');
  console.log('  js-doc-store-headless api --port 4000');
  console.log('  js-doc-store-headless export --schema blog_cms --output ./exports');
  console.log('  js-doc-store-headless import --schema blog_cms --output ./exports');
  console.log('  js-doc-store-headless deploy --schema blog_cms --output ./deploy');
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  showHelp();
  process.exit(0);
}

const portIndex = args.indexOf('--port') !== -1 ? args.indexOf('--port') : args.indexOf('-p');
const dataIndex = args.indexOf('--data') !== -1 ? args.indexOf('--data') : args.indexOf('-d');
const secretIndex = args.indexOf('--secret') !== -1 ? args.indexOf('--secret') : args.indexOf('-s');
const schemaIndex = args.indexOf('--schema') !== -1 ? args.indexOf('--schema') : -1;
const outputIndex = args.indexOf('--output') !== -1 ? args.indexOf('--output') : args.indexOf('-o');
const prefixIndex = args.indexOf('--prefix') !== -1 ? args.indexOf('--prefix') : -1;

if (portIndex !== -1) process.env.PORT = args[portIndex + 1];
if (dataIndex !== -1) process.env.DATA_DIR = args[dataIndex + 1];
if (secretIndex !== -1) process.env.JWT_SECRET = args[secretIndex + 1];

const serverDir = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(serverDir, 'schema-designer-data');

if (command === 'api') {
  require(path.join(serverDir, 'schema-api-auth-server.js'));
} else if (command === 'api:basic') {
  require(path.join(serverDir, 'schema-api-server.js'));
} else if (command === 'api:prod') {
  require(path.join(serverDir, 'schema-api-prod.js'));
} else if (command === 'mcp') {
  require(path.join(serverDir, 'schema-designer-server.js'));
} else if (command === 'mcp:memory') {
  require(path.join(serverDir, 'mcp-memory-server.js'));
} else if (command === 'list') {
  const { DocStore, FileStorageAdapter } = require(path.join(serverDir, 'js-doc-store.js'));
  const db = new DocStore(new FileStorageAdapter(dataDir));
  const schemas = db.collection('__schemas');
  const all = schemas.find({}).toArray();
  console.log('Found ' + all.length + ' schema(s):');
  for (const s of all) {
    console.log('  - ' + s.name + ': ' + s.description + ' (' + s.collections.length + ' collections)');
  }
} else if (command === 'export') {
  const schemaName = schemaIndex !== -1 ? args[schemaIndex + 1] : null;
  if (!schemaName) {
    console.log('Usage: js-doc-store-headless export --schema <name> [--output ./exports]');
    process.exit(1);
  }
  const { DocStore, FileStorageAdapter } = require(path.join(serverDir, 'js-doc-store.js'));
  const { exportSchema } = require(path.join(serverDir, 'schema-portable.js'));
  const db = new DocStore(new FileStorageAdapter(dataDir));
  const exportData = exportSchema(db, schemaName);
  const outDir = outputIndex !== -1 ? args[outputIndex + 1] : path.join(serverDir, 'exports');
  const outFile = path.join(outDir, schemaName + '.export.json');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(exportData, null, 2));
  console.log('Exported: ' + schemaName);
  console.log('File: ' + outFile);
  console.log('Collections: ' + exportData.collections.map(c => c.name).join(', '));
  console.log('Documents: ' + exportData.collections.reduce((s, c) => s + c.documentCount, 0));
} else if (command === 'import') {
  const schemaName = schemaIndex !== -1 ? args[schemaIndex + 1] : null;
  if (!schemaName) {
    console.log('Usage: js-doc-store-headless import --schema <name> --output <export.json> [--prefix dev_]');
    process.exit(1);
  }
  const outDir = outputIndex !== -1 ? args[outputIndex + 1] : path.join(serverDir, 'exports');
  const inFile = path.join(outDir, schemaName + '.export.json');
  if (!fs.existsSync(inFile)) {
    console.log('Export file not found: ' + inFile);
    process.exit(1);
  }
  const { DocStore, FileStorageAdapter } = require(path.join(serverDir, 'js-doc-store.js'));
  const { importSchema } = require(path.join(serverDir, 'schema-portable.js'));
  const db = new DocStore(new FileStorageAdapter(dataDir));
  const exportData = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const prefix = prefixIndex !== -1 ? args[prefixIndex + 1] : undefined;
  const result = importSchema(db, exportData, { force: true, prefix });
  console.log('Imported: ' + result.imported);
  console.log('Collections: ' + result.collections.join(', '));
  console.log('Documents: ' + result.documentCount);
} else if (command === 'deploy') {
  const schemaName = schemaIndex !== -1 ? args[schemaIndex + 1] : null;
  if (!schemaName) {
    console.log('Usage: js-doc-store-headless deploy --schema <name> [--output ./deploy]');
    process.exit(1);
  }
  const deployDir = outputIndex !== -1 ? args[outputIndex + 1] : path.join(process.cwd(), 'deploy');
  
  const { DocStore, FileStorageAdapter } = require(path.join(serverDir, 'js-doc-store.js'));
  const { exportSchema } = require(path.join(serverDir, 'schema-portable.js'));
  const db = new DocStore(new FileStorageAdapter(dataDir));
  const exportData = exportSchema(db, schemaName);
  
  fs.mkdirSync(deployDir, { recursive: true });
  fs.mkdirSync(path.join(deployDir, 'exports'), { recursive: true });
  
  fs.copyFileSync(path.join(serverDir, 'schema-api-prod.js'), path.join(deployDir, 'server.js'));
  fs.copyFileSync(path.join(serverDir, 'js-doc-store.js'), path.join(deployDir, 'js-doc-store.js'));
  fs.copyFileSync(path.join(serverDir, 'schema-portable.js'), path.join(deployDir, 'schema-portable.js'));
  fs.writeFileSync(path.join(deployDir, 'exports', schemaName + '.export.json'), JSON.stringify(exportData, null, 2));
  
  const pkg = {
    name: schemaName + '-api',
    version: '1.0.0',
    description: 'Headless API for ' + schemaName,
    main: 'server.js',
    scripts: { start: 'node server.js' },
    engines: { node: '>=18.0.0' }
  };
  fs.writeFileSync(path.join(deployDir, 'package.json'), JSON.stringify(pkg, null, 2));
  
  fs.writeFileSync(path.join(deployDir, '.env.example'), 'PORT=3000\nDATA_DIR=./data\nEXPORT_DIR=./exports\n');
  
  const readme = '# ' + schemaName + ' API\n\nHeadless CMS API generated from js-doc-store.\n\n## Quick Start\n\n`ash\nnode server.js\n`\n\nThe API will auto-import the schema and data from exports/.\n\n## Endpoints\n\n- GET /api - List schemas\n- GET /api/' + schemaName + ' - Schema architecture\n- GET /api/' + schemaName + '/:collection - List documents\n- GET /api/' + schemaName + '/:collection/:id - Get document\n- POST /api/' + schemaName + '/:collection - Create document\n- PUT /api/' + schemaName + '/:collection/:id - Update document\n- DELETE /api/' + schemaName + '/:collection/:id - Delete document\n\n## Deploy\n\nPush to Railway, Render, or any Node.js host.\n';
  fs.writeFileSync(path.join(deployDir, 'README.md'), readme);
  
  console.log('Deployment package created: ' + deployDir);
  console.log('');
  console.log('Files:');
  console.log('  - server.js         (API server)');
  console.log('  - js-doc-store.js   (Database engine)');
  console.log('  - schema-portable.js (Import logic)');
  console.log('  - exports/' + schemaName + '.export.json (Schema + data)');
  console.log('  - package.json');
  console.log('  - .env.example');
  console.log('  - README.md');
  console.log('');
  console.log('To run locally:');
  console.log('  cd ' + deployDir);
  console.log('  node server.js');
  console.log('');
  console.log('To deploy to production:');
  console.log('  cd ' + deployDir);
  console.log('  git init && git add . && git commit -m deploy');
  console.log('  # Push to Railway, Render, or any Node.js host');
} else {
  console.log('Unknown command: ' + command);
  showHelp();
  process.exit(1);
}