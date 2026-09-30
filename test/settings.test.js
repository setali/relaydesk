import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { PanelStore } from '../src/panel-store.js';
import { DemoPanel, ThreeXUI } from '../src/panel.js';
import { runSetup } from '../src/setup.js';
import { configFromEnv } from '../src/config.js';
const origin = 'https://relay.example.com',
  secret = 'a-private-test-password';
test('discovery rejects malformed and duplicate inbound identifiers', async () => {
  const adapter = new ThreeXUI({});
  for (const ids of [[1, 1], ['<img src=x>'], [0], [null]]) {
    adapter.request = async () =>
      ids.map((id) => ({ id, protocol: 'vless', settings: { clients: [] } }));
    await assert.rejects(adapter.discover(), /Unsupported inbound identifier/);
  }
});
const panel = {
  id: 'primary',
  name: 'Germany',
  baseUrl: 'https://panel.example.com/private',
  token: 'synthetic-api-secret',
  inbounds: [{ id: 1, name: 'Direct' }],
};
class FakePanel extends DemoPanel {
  async discover() {
    return [
      { id: 1, name: 'Direct', protocol: 'vless' },
      { id: 2, name: 'Tunnel', protocol: 'vmess' },
    ];
  }
}
async function fixture(t) {
  const app = await createApp(
    {
      database: ':memory:',
      demo: false,
      secure: true,
      origin,
      adminEmail: 'owner@example.com',
      adminUsername: 'owner',
      adminPassword: secret,
      panels: [],
    },
    {
      adapterFactory: (p) =>
        p.name === 'Offline'
          ? {
              discover: async () => {
                throw new Error('offline');
              },
            }
          : new FakePanel(),
    },
  );
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, method = 'GET', body, session) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: res.status,
      data: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function login(username = 'owner', password = secret) {
    const response = await request('/login', 'POST', { username, password });
    return { ...response, ...response.data };
  }
  const admin = await login();
  assert.equal(admin.status, 200);
  return { ...app, request, login, admin };
}
test('account edits require current password and revoke every old session', async (t) => {
  const f = await fixture(t),
    second = await f.login();
  const update = {
    username: 'new-owner',
    name: 'Owner',
    currentPassword: 'incorrect',
    newPassword: 'a-different-long-password',
  };
  assert.equal((await f.request('/account', 'PATCH', update, f.admin)).status, 403);
  update.currentPassword = secret;
  assert.equal((await f.request('/account', 'PATCH', update, f.admin)).status, 200);
  assert.equal((await f.request('/me', 'GET', null, second)).status, 401);
  assert.equal((await f.login('owner', secret)).status, 401);
  assert.equal((await f.login('new-owner', secret)).status, 401);
  assert.equal((await f.login('new-owner', update.newPassword)).status, 200);
});
test('only admins can manage panels; tokens are encrypted and never returned; edits retain blank token', async (t) => {
  const f = await fixture(t);
  await f.request(
    '/resellers',
    'POST',
    { name: 'Studio', email: 'studio@example.com', password: secret, maxClients: 2, quotaGB: 50 },
    f.admin,
  );
  const reseller = await f.login('studio@example.com');
  assert.equal((await f.request('/panels', 'GET', null, reseller)).status, 403);
  assert.equal((await f.request('/panels/probe', 'POST', panel, reseller)).status, 403);
  const probe = await f.request('/panels/probe', 'POST', panel, f.admin);
  assert.equal(probe.status, 200);
  assert.equal(probe.data.inbounds.length, 2);
  const saved = await f.request('/panels', 'POST', panel, f.admin);
  assert.equal(saved.status, 201);
  assert.equal(JSON.stringify(saved.data).includes(panel.token), false);
  const row = f.db.prepare('SELECT * FROM panels').get();
  assert.equal(JSON.stringify(row).includes(panel.token), false);
  const edited = await f.request(
    '/panels',
    'POST',
    { ...panel, name: 'Renamed', token: '' },
    f.admin,
  );
  assert.equal(edited.status, 200);
  assert.equal(edited.data.panel.hasToken, true);
  const rotated = await f.request(
    '/panels',
    'POST',
    { ...panel, token: 'replacement-synthetic-token' },
    f.admin,
  );
  assert.equal(rotated.status, 200);
  assert.notEqual(
    f.db.prepare('SELECT token_cipher FROM panels').get().token_cipher,
    row.token_cipher,
  );
  assert.equal((await f.request('/panels/primary', 'DELETE', null, f.admin)).status, 200);
});
test('managed clients prevent panel retargeting, inbound removal, and server deletion', async (t) => {
  const f = await fixture(t);
  await f.request('/panels', 'POST', panel, f.admin);
  const created = await f.request(
    '/clients',
    'POST',
    {
      requestId: randomUUID(),
      name: 'Phone',
      panelId: 'primary',
      inboundId: 1,
      quotaGB: 10,
      days: 30,
    },
    f.admin,
  );
  assert.equal(created.status, 201);
  assert.equal(
    (await f.request('/panels', 'POST', { ...panel, baseUrl: 'https://other.example' }, f.admin))
      .status,
    409,
  );
  assert.equal(
    (
      await f.request(
        '/panels',
        'POST',
        { ...panel, inbounds: [{ id: 2, name: 'Tunnel' }] },
        f.admin,
      )
    ).status,
    409,
  );
  assert.equal((await f.request('/panels/primary', 'DELETE', null, f.admin)).status, 409);
  assert.equal(
    (await f.request('/panels', 'POST', { ...panel, token: 'rotated-token' }, f.admin)).status,
    200,
  );
});
test('failed probe does not save configuration; credentials cannot be sent over HTTP', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request('/panels', 'POST', { ...panel, baseUrl: 'http://example.com' }, f.admin))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request(
        '/panels',
        'POST',
        { ...panel, inbounds: [{ id: 999, name: 'Unknown' }] },
        f.admin,
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.request('/panels', 'POST', { ...panel, name: 'Offline' }, f.admin)).status,
    502,
  );
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM panels').get().n, 0);
});
test('v1 migration preserves accounts and rejects newer database versions', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-migrate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'old.sqlite'),
    old = new DatabaseSync(path);
  old.exec(
    `CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,max_clients INTEGER NOT NULL,quota_gb INTEGER NOT NULL,created_at INTEGER NOT NULL); PRAGMA user_version=1;`,
  );
  old
    .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
    .run('owner', 'owner@example.com', 'Owner', 'hash', 'admin', 20, 500, 1);
  old.close();
  const migrated = openDatabase(path);
  assert.equal(migrated.prepare('SELECT username FROM users').get().username, 'owner@example.com');
  assert.equal(migrated.prepare('PRAGMA user_version').get().user_version, 2);
  migrated.close();
  const again = openDatabase(path);
  assert.equal(again.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  again.exec('PRAGMA user_version=3');
  again.close();
  assert.throws(() => openDatabase(path), /newer/);
});
test('encrypted panel persistence survives restart; import is one-time; missing key fails closed', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'store.sqlite'),
    db = openDatabase(database);
  let store = new PanelStore(db, { database });
  store.importLegacy([panel]);
  assert.equal(store.all()[0].token, panel.token);
  store.save({ ...panel, token: 'rotated-secret' });
  db.close();
  const reopened = openDatabase(database);
  store = new PanelStore(reopened, { database });
  store.importLegacy([panel]);
  assert.equal(store.all()[0].token, 'rotated-secret');
  unlinkSync(join(directory, 'master.key'));
  assert.throws(() => new PanelStore(reopened, { database }), /key is missing/);
  reopened.close();
});
test('guided setup writes no plaintext credentials, imports approved inbounds and refuses reinstall', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-setup-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'runtime.json'),
    outputs = [];
  const answers = [
    origin,
    'operator',
    'operator@example.com',
    secret,
    secret,
    'y',
    'primary',
    'Germany',
    panel.baseUrl,
    panel.token,
    '',
    '1',
    'y',
  ];
  await runSetup({
    runtimeFile: file,
    ask: async () => answers.shift(),
    print: (s) => outputs.push(s),
    discover: async () => [{ id: 1, name: 'Direct', protocol: 'vless' }],
  });
  const raw = readFileSync(file, 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes(panel.token), false);
  assert.equal(outputs.join('\n').includes(secret), false);
  const config = configFromEnv({ RELAYDESK_CONFIG: file });
  const db = openDatabase(config.database),
    store = new PanelStore(db, config);
  assert.equal(db.prepare('SELECT username FROM users').get().username, 'operator');
  assert.equal(store.all()[0].inbounds[0].flow, 'xtls-rprx-vision');
  db.close();
  await assert.rejects(
    runSetup({ runtimeFile: file, ask: async () => '', print: () => {} }),
    /already exists/,
  );
});
test('failed setup verification never creates an installation', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-failed-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'runtime.json');
  const answers = [
    origin,
    'operator',
    'operator@example.com',
    secret,
    secret,
    'y',
    'primary',
    'Germany',
    panel.baseUrl,
    panel.token,
    '',
  ];
  await assert.rejects(
    runSetup({
      runtimeFile: file,
      ask: async () => answers.shift(),
      print: () => {},
      discover: async () => {
        throw new Error('offline');
      },
    }),
    /verification failed/,
  );
  assert.throws(() => readFileSync(file), /ENOENT/);
  assert.throws(() => readFileSync(join(directory, 'relaydesk.sqlite')), /ENOENT/);
});
