import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assert } from './security.js';

export function validatePanel(input, previous) {
  assert(input && typeof input === 'object', 400, 'Invalid server configuration.');
  const result = {
    id: input.id,
    name: input.name,
    baseUrl: input.baseUrl,
    token: input.token || previous?.token,
    subscriptionBaseUrl: input.subscriptionBaseUrl || '',
    inbounds: input.inbounds,
  };
  assert(
    typeof result.id === 'string' && /^[a-z0-9-]{1,40}$/.test(result.id),
    400,
    'Use a short lowercase server ID.',
  );
  assert(
    typeof result.name === 'string' && result.name.trim().length > 0 && result.name.length <= 80,
    400,
    'Server name must contain 1–80 characters.',
  );
  result.name = result.name.trim();
  for (const key of ['baseUrl', 'subscriptionBaseUrl']) {
    if (key === 'subscriptionBaseUrl' && !result[key]) continue;
    assert(
      typeof result[key] === 'string' && result[key].length <= 2048,
      400,
      'Enter an HTTPS URL.',
    );
    let url;
    try {
      url = new URL(result[key]);
    } catch {
      assert(false, 400, 'Enter a valid HTTPS URL.');
    }
    assert(
      url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      400,
      'Server URLs must use HTTPS without credentials, query strings or fragments.',
    );
    result[key] = url.href.replace(/\/$/, '');
  }
  assert(
    typeof result.token === 'string' &&
      result.token.trim().length > 0 &&
      result.token.length <= 4096 &&
      !/[\r\n]/.test(result.token),
    400,
    'An API token is required.',
  );
  result.token = result.token.trim();
  assert(
    Array.isArray(result.inbounds) && result.inbounds.length <= 100,
    400,
    'Choose at most 100 inbounds.',
  );
  const ids = new Set();
  result.inbounds = result.inbounds.map((i) => {
    assert(
      Number.isSafeInteger(i.id) && i.id > 0 && !ids.has(i.id),
      400,
      'Inbound IDs must be unique positive integers.',
    );
    ids.add(i.id);
    assert(
      typeof i.name === 'string' && i.name.trim() && i.name.length <= 80,
      400,
      'Enter a name for each inbound.',
    );
    assert(!i.flow || i.flow === 'xtls-rprx-vision', 400, 'Unsupported flow.');
    return { id: i.id, name: i.name.trim(), flow: i.flow || '' };
  });
  return result;
}

export class PanelStore {
  constructor(db, { database, encryptionKeyPath, demo }) {
    this.db = db;
    if (demo || database === ':memory:') this.key = randomBytes(32);
    else {
      const path = encryptionKeyPath || join(dirname(database), 'master.key');
      try {
        this.key = readFileSync(path);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (db.prepare('SELECT count(*) AS n FROM panels').get().n)
          throw new Error(
            'Encryption key is missing. Restore master.key from your backup; do not generate a replacement.',
          );
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        this.key = randomBytes(32);
        writeFileSync(path, this.key, { flag: 'wx', mode: 0o600 });
      }
      chmodSync(path, 0o600);
      if (this.key.length !== 32) throw new Error('Encryption key must contain exactly 32 bytes.');
    }
  }
  seal(id, value) {
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(id));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
  }
  unseal(id, value) {
    const bytes = Buffer.from(value, 'base64'),
      decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(id));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }
  all() {
    return this.db
      .prepare('SELECT * FROM panels ORDER BY id')
      .all()
      .map((row) => ({
        ...JSON.parse(row.settings),
        token: this.unseal(row.id, row.token_cipher),
      }));
  }
  save(panel) {
    const { token, ...settings } = panel;
    this.db
      .prepare(
        'INSERT INTO panels VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET settings=excluded.settings,token_cipher=excluded.token_cipher,updated_at=excluded.updated_at',
      )
      .run(panel.id, JSON.stringify(settings), this.seal(panel.id, token), Date.now());
  }
  remove(id) {
    this.db.prepare('DELETE FROM panels WHERE id=?').run(id);
  }
  importLegacy(panels) {
    if (this.db.prepare("SELECT value FROM metadata WHERE key='panels-imported'").get()) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const panel of panels) this.save(validatePanel(panel));
      this.db.prepare("INSERT INTO metadata VALUES('panels-imported','1')").run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
export const publicPanel = ({ token, ...panel }) => ({ ...panel, hasToken: !!token });
