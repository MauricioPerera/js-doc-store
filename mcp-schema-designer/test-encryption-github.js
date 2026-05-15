// Integration test: EncryptedAdapter + GitStorageAdapter (autoPush to GitHub)
// Validates:
// 1. Data is encrypted at rest (EncryptedAdapter)
// 2. Encrypted data is pushed to GitHub (GitStorageAdapter with autoPush)
// 3. Field-level encryption/decryption works (FieldCrypto)

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const {
  DocStore,
  FileStorageAdapter,
  EncryptedAdapter,
  GitStorageAdapter,
  FieldCrypto,
} = require('../js-doc-store.js');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'f24dd51ad14a7ea89eb19a7a80e01684384a9fc55ffb3cd0d2ba62154f115083';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || null;
const GITHUB_USER = 'MauricioPerera';
const GITHUB_REPO = 'test-encrypted-git-store';

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jds-enc-git-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  // ---------------------------------------------------------------------------
  // 1. FieldCrypto: encrypt/decrypt a field value directly
  // ---------------------------------------------------------------------------
  console.log('\n=== 1. FieldCrypto (field-level encryption) ===');
  const fieldCrypto = await FieldCrypto.create(ENCRYPTION_KEY);
  const plaintext = 'sensitive-user-email@example.com';
  const encrypted = await fieldCrypto.encrypt(plaintext);

  assert('field_crypto: encrypted string is not plaintext', encrypted !== plaintext);
  assert('field_crypto: encrypted string has $enc$ marker', encrypted.startsWith('$enc$'));

  const decrypted = await fieldCrypto.decrypt(encrypted);
  assert('field_crypto: decrypted matches original', decrypted === plaintext);

  // ---------------------------------------------------------------------------
  // 2. EncryptedAdapter: data at rest is encrypted
  // ---------------------------------------------------------------------------
  console.log('\n=== 2. EncryptedAdapter (adapter-level encryption) ===');
  const dataDir = freshDir();
  const inner = new FileStorageAdapter(dataDir);
  const encAdapter = await EncryptedAdapter.create(inner, ENCRYPTION_KEY);
  const db = new DocStore(encAdapter);

  db.collection('users').insert({
    _id: 'user-1',
    name: 'Alice',
    email: 'alice@secret.com',
    ssn: '123-45-6789',
  });
  db.flush();
  await encAdapter.persist();

  // Read raw file from disk
  const rawFile = path.join(dataDir, 'users.docs.json');
  assert('enc_adapter: docs file exists', fs.existsSync(rawFile));

  const rawContent = fs.readFileSync(rawFile, 'utf8');
  assert('enc_adapter: raw content is encrypted (has __enc)', rawContent.includes('__enc'));
  assert('enc_adapter: raw content does NOT contain plaintext email', !rawContent.includes('alice@secret.com'));
  assert('enc_adapter: raw content does NOT contain plaintext ssn', !rawContent.includes('123-45-6789'));

  // Verify reload and decryption works
  const inner2 = new FileStorageAdapter(dataDir);
  const encAdapter2 = await EncryptedAdapter.create(inner2, ENCRYPTION_KEY);
  await encAdapter2.preloadAll();
  const db2 = new DocStore(encAdapter2);
  const doc = db2.collection('users').findOne({ _id: 'user-1' });
  assert('enc_adapter: reload decrypts name correctly', doc.name === 'Alice');
  assert('enc_adapter: reload decrypts email correctly', doc.email === 'alice@secret.com');
  assert('enc_adapter: reload decrypts ssn correctly', doc.ssn === '123-45-6789');

  // ---------------------------------------------------------------------------
  // 3. EncryptedAdapter + GitStorageAdapter + autoPush to GitHub
  // ---------------------------------------------------------------------------
  console.log('\n=== 3. EncryptedAdapter + GitStorageAdapter (autoPush to GitHub) ===');

  if (!GITHUB_TOKEN) {
    console.log('SKIP: GITHUB_TOKEN not set; skipping GitHub push test.');
    console.log('      Set GITHUB_TOKEN to validate autoPush.');
    rmDir(dataDir);
    console.log('\nPartial assertions passed (encryption only).');
    process.exit(0);
  }

  // Create a temp dir that will be a git repo synced to GitHub
  const gitDir = freshDir();
  const gitDataDir = path.join(gitDir, 'data');
  fs.mkdirSync(gitDataDir, { recursive: true });

  // Init git repo and configure remote
  execSync('git init', { cwd: gitDir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'ignore' });
  execSync('git config user.name "Test Bot"', { cwd: gitDir, stdio: 'ignore' });
  execSync(`git remote add origin https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git`, { cwd: gitDir, stdio: 'ignore' });

  // Create initial commit so we can push
  fs.writeFileSync(path.join(gitDir, 'README.md'), '# Test Encrypted Git Store\n');
  execSync('git add README.md', { cwd: gitDir, stdio: 'ignore' });
  execSync('git commit -m "init"', { cwd: gitDir, stdio: 'ignore' });
  execSync('git push -u origin master', { cwd: gitDir, stdio: 'ignore' });

  // Set up adapters: FileStorage -> Encrypted -> GitStorage
  const gitInner = new FileStorageAdapter(gitDataDir);
  const gitEncAdapter = await EncryptedAdapter.create(gitInner, ENCRYPTION_KEY);
  const gitAdapter = new GitStorageAdapter(gitEncAdapter, {
    repoPath: gitDir,
    autoPush: true,
    pushRemote: 'origin',
    pushBranch: 'master',
    onError: (err) => console.error('GitStorageAdapter error:', err.message),
  });

  const gitDb = new DocStore(gitAdapter);
  gitDb.collection('secrets').insert({
    _id: 'secret-1',
    apiKey: 'sk-live-1234567890abcdef',
    password: 'hunter2',
  });
  gitDb.flush();
  await gitAdapter.persist();

  // Verify local encrypted file does NOT leak plaintext
  const gitRawFile = path.join(gitDataDir, 'secrets.docs.json');
  const gitRawContent = fs.readFileSync(gitRawFile, 'utf8');
  assert('git_enc: raw file is encrypted', gitRawContent.includes('__enc'));
  assert('git_enc: raw file does NOT leak apiKey', !gitRawContent.includes('sk-live-'));
  assert('git_enc: raw file does NOT leak password', !gitRawContent.includes('hunter2'));

  // Verify the commit reached GitHub
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2000);

  const remoteFiles = execSync(`git ls-tree -r --name-only origin/master`, { cwd: gitDir, encoding: 'utf8' }).trim();
  assert('git_push: data/secrets.docs.json reached GitHub', remoteFiles.includes('data/secrets.docs.json'));

  // Verify we can clone and decrypt from the remote
  const cloneDir = freshDir();
  execSync(`git clone https://${GITHUB_USER}:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${GITHUB_REPO}.git "${cloneDir}"`, { stdio: 'ignore' });
  const clonedDataDir = path.join(cloneDir, 'data');
  const clonedInner = new FileStorageAdapter(clonedDataDir);
  const clonedEnc = await EncryptedAdapter.create(clonedInner, ENCRYPTION_KEY);
  await clonedEnc.preloadAll();
  const clonedDb = new DocStore(clonedEnc);
  const clonedDoc = clonedDb.collection('secrets').findOne({ _id: 'secret-1' });
  assert('git_enc_clone: decrypted apiKey matches', clonedDoc.apiKey === 'sk-live-1234567890abcdef');
  assert('git_enc_clone: decrypted password matches', clonedDoc.password === 'hunter2');

  // Cleanup
  gitAdapter.destroy();
  rmDir(dataDir);
  rmDir(gitDir);
  rmDir(cloneDir);

  console.log('\nAll assertions passed.');
})().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(1);
});
