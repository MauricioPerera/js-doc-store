// Regression tests for issues #14, #15, #16, #17:
// https://github.com/MauricioPerera/js-doc-store/issues/14
// https://github.com/MauricioPerera/js-doc-store/issues/15
// https://github.com/MauricioPerera/js-doc-store/issues/16
// https://github.com/MauricioPerera/js-doc-store/issues/17
//
// All four issues concern GitStorageAdapter.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { DocStore, FileStorageAdapter, GitStorageAdapter } = require('../js-doc-store.js');

function assert(name, cond) {
  if (!cond) { console.error('FAIL:', name); process.exit(1); }
  console.log('OK  :', name);
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jds-git-'));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function gitLogCount(cwd) {
  try {
    return execSync('git log --oneline', { cwd, encoding: 'utf-8' }).trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function gitShowNameStatus(cwd, commitRef = 'HEAD') {
  try {
    return execSync(`git show --name-status --format= ${commitRef}`, { cwd, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

(async () => {

  // ---------------------------------------------------------------------------
  // Issue #14: git add -A stages unrelated files outside the data directory
  // ---------------------------------------------------------------------------
  {
    const repoDir = freshDir();
    const dataDir = path.join(repoDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Init a real git repo so GitStorageAdapter can commit
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });

    const inner = new FileStorageAdapter(dataDir);
    const adapter = new GitStorageAdapter(inner, { repoPath: repoDir });
    const db = new DocStore(adapter);

    // Write a file outside the data directory
    const outsideFile = path.join(repoDir, 'outside.txt');
    fs.writeFileSync(outsideFile, 'unrelated');

    // Write a doc inside the data directory via the adapter
    db.collection('users').insert({ name: 'Alice' });
    db.flush();
    await adapter.persist();

    // Verify the commit only touched the data directory
    const nameStatus = gitShowNameStatus(repoDir);
    assert('#14: commit includes data file', nameStatus.includes('users.docs.json'));
    assert('#14: commit does NOT include outside.txt', !nameStatus.includes('outside.txt'));

    adapter.destroy();
    rmDir(repoDir);
  }

  // ---------------------------------------------------------------------------
  // Issue #15: --allow-empty generates empty commits when no real changes
  // ---------------------------------------------------------------------------
  {
    const repoDir = freshDir();
    const dataDir = path.join(repoDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });

    const inner = new FileStorageAdapter(dataDir);
    const adapter = new GitStorageAdapter(inner, { repoPath: repoDir });
    const db = new DocStore(adapter);

    // First commit: real change
    db.collection('users').insert({ name: 'Bob' });
    db.flush();
    await adapter.persist();
    const countAfterFirst = gitLogCount(repoDir);
    assert('#15: first commit exists', countAfterFirst === 1);

    // Second persist: no changes
    await adapter.persist();
    const countAfterSecond = gitLogCount(repoDir);
    assert('#15: no empty commit on second persist', countAfterSecond === 1);

    adapter.destroy();
    rmDir(repoDir);
  }

  // ---------------------------------------------------------------------------
  // Issue #16: persist() silently ignores explicit flush calls in batch mode
  // ---------------------------------------------------------------------------
  {
    const repoDir = freshDir();
    const dataDir = path.join(repoDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });

    const inner = new FileStorageAdapter(dataDir);
    // Batch interval so long the timer would never fire during the test
    const adapter = new GitStorageAdapter(inner, { repoPath: repoDir, batchIntervalMs: 999999 });
    const db = new DocStore(adapter);

    db.collection('users').insert({ name: 'Charlie' });
    db.flush();
    // writeJson schedules a batch timer; persist() should cancel it and commit immediately
    await adapter.persist();

    const count = gitLogCount(repoDir);
    assert('#16: explicit persist commits immediately despite batch timer', count === 1);

    adapter.destroy();
    rmDir(repoDir);
  }

  // ---------------------------------------------------------------------------
  // Issue #17: catch {} vacios ocultan todos los errores de git
  // ---------------------------------------------------------------------------
  {
    const repoDir = freshDir();
    const dataDir = path.join(repoDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // Force a push failure: configure an invalid remote.
    execSync('git init', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
    execSync('git remote add origin http://invalid.remote.test/nonexistent', { cwd: repoDir, stdio: 'ignore' });

    const inner = new FileStorageAdapter(dataDir);

    const pushErrors = [];
    const adapter = new GitStorageAdapter(inner, {
      repoPath: repoDir,
      autoPush: true,
      onError: (err) => pushErrors.push(err),
    });
    const db = new DocStore(adapter);

    db.collection('users').insert({ name: 'Eve' });
    db.flush();
    await adapter.persist();

    assert('#17: onError received at least one git error', pushErrors.length >= 1);
    assert('#17: error is an Error instance', pushErrors[0] instanceof Error);

    adapter.destroy();
    rmDir(repoDir);
  }

  console.log('\nAll assertions passed.');

})().catch((err) => { console.error('UNCAUGHT:', err); process.exit(1); });
