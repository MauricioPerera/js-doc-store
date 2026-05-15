/**
 * Pruebas para los fixes de la sesión actual.
 * Issue #18: EncryptedAdapter writeBin/readBin encryption
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const {
  EncryptedAdapter,
  FileStorageAdapter,
  MemoryStorageAdapter,
} = require('./js-doc-store');

// MemoryStorageAdapter con soporte binario (js-doc-store's built-in no tiene readBin/writeBin)
class BinaryMemoryAdapter {
  constructor() { this._json = new Map(); this._bin = new Map(); }
  readJson(k)      { return this._json.get(k) ?? null; }
  writeJson(k, v)  { this._json.set(k, v); }
  delete(k)        { this._json.delete(k); this._bin.delete(k); }
  readBin(k)       { return this._bin.get(k) ?? null; }
  writeBin(k, v)   { this._bin.set(k, v); }
  listKeys()       { return [...new Set([...this._json.keys(), ...this._bin.keys()])]; }
}

let passed = 0, failed = 0;

function assert(label, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  OK: ${label}`);
  } else {
    failed++;
    console.log(`  FAIL: ${label}${extra ? ' — ' + extra : ''}`);
  }
}

async function main() {
  // ────────────────────────────────────────────────────────
  // #18 — EncryptedAdapter: writeBin cifra, readBin descifra
  // ────────────────────────────────────────────────────────
  console.log('\n#18 — EncryptedAdapter binary encryption\n');

  // 1. Con BinaryMemoryAdapter (simula adapter con soporte binario)
  {
    const inner = new BinaryMemoryAdapter();
    const enc = await EncryptedAdapter.create(inner, 'secret-password');

    const original = new Uint8Array([1, 2, 3, 4, 5, 128, 200, 255]).buffer;
    enc.writeBin('test.bin', original);

    // El inner NO debe tener el binario todavía (no se persiste hasta persist())
    assert('writeBin: inner no tiene el bin antes de persist()', inner.readBin('test.bin') === null);

    // readBin desde cache (sin preload) debe devolver el original
    const fromCache = enc.readBin('test.bin');
    assert(
      'readBin desde _binCache devuelve datos originales',
      fromCache && new Uint8Array(fromCache).join(',') === '1,2,3,4,5,128,200,255'
    );

    // persist() debe cifrar y escribir en el inner
    await enc.persist();
    const onDisk = inner.readBin('test.bin');
    assert('persist() escribió en el inner adapter', onDisk !== null);

    // El binario en disco no debe coincidir con el original (está cifrado)
    const diskBytes = new Uint8Array(onDisk);
    const origBytes = new Uint8Array(original);
    assert(
      'binario en disco difiere del original (cifrado)',
      diskBytes.length !== origBytes.length ||
        !diskBytes.every((b, i) => b === origBytes[i])
    );

    // Magic header ENC\x01
    assert(
      'binario en disco comienza con magic ENC\\x01',
      diskBytes[0] === 0x45 && diskBytes[1] === 0x4E &&
        diskBytes[2] === 0x43 && diskBytes[3] === 0x01
    );
  }

  // 2. Preload + descifrado desde disco
  {
    const inner = new BinaryMemoryAdapter();
    const enc = await EncryptedAdapter.create(inner, 'another-pass');

    const buf = new Uint8Array([10, 20, 30, 40]).buffer;
    enc.writeBin('data.bin', buf);
    await enc.persist();

    const enc2 = await EncryptedAdapter.create(inner, 'another-pass');
    await enc2.preload(['data.bin']);
    const recovered = enc2.readBin('data.bin');
    assert(
      'preload() + readBin() recupera datos cifrados correctamente',
      recovered && new Uint8Array(recovered).join(',') === '10,20,30,40'
    );
  }

  // 3. Clave incorrecta → error al preload
  {
    const inner = new BinaryMemoryAdapter();
    const enc = await EncryptedAdapter.create(inner, 'right-pass');
    enc.writeBin('secret.bin', new Uint8Array([99]).buffer);
    await enc.persist();

    const enc3 = await EncryptedAdapter.create(inner, 'wrong-pass');  // wrong key
    await enc3.preload(['secret.bin']);
    let threw = false;
    try { enc3.readBin('secret.bin'); } catch { threw = true; }
    assert('clave incorrecta lanza error en readBin()', threw);
  }

  // 4. Binario legacy (sin cifrar) se lee transparentemente
  {
    const inner = new BinaryMemoryAdapter();
    const legacyBuf = new Uint8Array([7, 8, 9]).buffer;
    inner.writeBin('legacy.bin', legacyBuf);

    const enc = await EncryptedAdapter.create(inner, 'pass');
    const read = enc.readBin('legacy.bin');
    assert(
      'binario legacy (sin cifrar) se lee sin error',
      read && new Uint8Array(read).join(',') === '7,8,9'
    );
  }

  // 5. delete() limpia binPending y binCache
  {
    const inner = new BinaryMemoryAdapter();
    const enc = await EncryptedAdapter.create(inner, 'pass');
    enc.writeBin('todelete.bin', new Uint8Array([1, 2]).buffer);
    enc.delete('todelete.bin');
    await enc.persist();
    assert('delete() antes de persist(): inner no recibe el bin', inner.readBin('todelete.bin') === null);
  }

  // 6. FileStorageAdapter de js-doc-store es JSON-only: persist() no escribe binarios
  //    (el guard typeof inner.writeBin === 'function' lo omite silenciosamente)
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enc-test-'));
    try {
      const inner = new FileStorageAdapter(tmpDir);
      const enc = await EncryptedAdapter.create(inner, 'disk-pass');

      const buf = new Uint8Array([11, 22, 33, 44, 55]).buffer;
      enc.writeBin('file.bin', buf);
      await enc.persist();

      // FileStorageAdapter no tiene writeBin → persist() no crea el archivo
      assert(
        'FileStorageAdapter JSON-only: persist() no crea archivo binario',
        !fs.existsSync(path.join(tmpDir, 'file.bin'))
      );
      // Pero readBin() sigue disponible desde _binCache (sesión en curso)
      const fromCache = enc.readBin('file.bin');
      assert(
        'readBin() desde _binCache funciona aunque inner sea JSON-only',
        fromCache && new Uint8Array(fromCache).join(',') === '11,22,33,44,55'
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  }

  // ─────────────────────────────────────────────────────────
  console.log(`\nResultado: ${passed} OK, ${failed} FAIL`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
