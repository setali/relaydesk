import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/app.js';
import { DemoPanel } from '../src/panel.js';
import { openDatabase } from '../src/db.js';
const password = 'a-private-test-password';
const panels = ['first', 'second'].map((id) => ({
  id,
  name: id,
  inbounds: [{ id: 1, name: 'Direct' }],
}));
const config = () => ({
  database: ':memory:',
  demo: true,
  secure: false,
  origin: 'http://127.0.0.1',
  adminEmail: 'admin@example.com',
  adminPassword: password,
  panels: structuredClone(panels),
});
async function fixture(t) {
  const adapters = new Map(panels.map((p) => [p.id, new DemoPanel()]));
  const app = await createApp(config(), { adapters });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((r) => app.server.close(r));
    app.db.close();
  });
  async function request(path, session, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`, {
      method,
      headers: {
        Origin: 'http://127.0.0.1',
        'Content-Type': 'application/json',
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json(), headers: response.headers };
  }
  async function login(email) {
    const result = await request('/login', null, 'POST', { email, password });
    assert.equal(result.status, 200);
    return { ...result.data, cookie: result.headers.get('set-cookie').split(';')[0] };
  }
  const admin = await login('admin@example.com');
  async function member(panelIds) {
    const email = `${randomUUID()}@example.com`;
    const result = await request('/resellers', admin, 'POST', {
      email,
      name: 'Member',
      password,
      maxClients: 10,
      quotaGB: 100,
      ...(panelIds === undefined ? {} : { panelIds }),
    });
    assert.equal(result.status, 201);
    return login(email);
  }
  const create = (session, panelId, extra = {}) =>
    request('/clients', session, 'POST', {
      requestId: randomUUID(),
      name: 'Phone',
      panelId,
      inboundId: 1,
      quotaGB: 10,
      days: 30,
      ...extra,
    });
  return { ...app, request, admin, member, create };
}
test('server grants scope templates, creation, sync and owner assignment; omission denies all', async (t) => {
  const f = await fixture(t),
    member = await f.member(['first']),
    empty = await f.member();
  const workspace = (await f.request('/workspace', member)).data;
  assert.deepEqual(
    workspace.panels.map((p) => p.id),
    ['first'],
  );
  assert.deepEqual(
    workspace.templates.map((p) => p.panelId),
    ['first'],
  );
  assert.equal(JSON.stringify(workspace).includes('second'), false);
  assert.equal((await f.request('/workspace', empty)).data.templates.length, 0);
  assert.equal((await f.create(empty, 'first')).status, 403);
  assert.equal((await f.create(member, 'second')).status, 403);
  assert.equal((await f.create(f.admin, 'second', { ownerId: member.user.id })).status, 403);
  assert.equal((await f.create(member, 'first')).status, 201);
  f.adapters.get('second').snapshot = async () => {
    assert.fail('Forbidden server must not be contacted');
  };
  assert.deepEqual((await f.request('/sync', member, 'POST', {})).data.results, [
    { panel: 'first', ok: true },
  ]);
  assert.equal((await f.request('/panels', member)).status, 403);
  assert.equal(
    (
      await f.request(`/members/${member.user.id}/servers`, member, 'PATCH', {
        panelIds: ['second'],
      })
    ).status,
    403,
  );
});
test('grant edits validate IDs, immediately deny replay/delete/read, and preserve remote clients', async (t) => {
  const f = await fixture(t),
    member = await f.member(['first']);
  const created = await f.create(member, 'first'),
    id = created.data.client.id;
  const path = `/members/${member.user.id}/servers`;
  for (const panelIds of [['missing'], ['first', 'first'], null])
    assert.equal((await f.request(path, f.admin, 'PATCH', { panelIds })).status, 400);
  assert.equal(
    (await f.request(path, f.admin, 'PATCH', { panelIds: ['first', 'second'] })).status,
    200,
  );
  assert.equal((await f.request('/workspace', member)).data.templates.length, 2);
  assert.equal((await f.request(path, f.admin, 'PATCH', { panelIds: [] })).status, 200);
  assert.equal((await f.request('/workspace', member)).data.clients.length, 0);
  assert.equal((await f.request(`/clients/${id}`, member, 'DELETE')).status, 404);
  assert.equal((await f.create(member, 'first', { requestId: id })).status, 403);
  assert.equal(f.db.prepare('SELECT status FROM clients WHERE id=?').get(id).status, 'active');
  assert.equal((await f.request('/workspace', f.admin)).data.clients.length, 1);
  assert.equal((await f.request(`/clients/${id}`, f.admin, 'DELETE')).status, 200);
});
test('access changes wait for in-flight member operations', async (t) => {
  const f = await fixture(t),
    member = await f.member(['first']);
  let release, entered;
  const gate = new Promise((r) => {
    release = r;
  });
  const started = new Promise((r) => {
    entered = r;
  });
  const adapter = f.adapters.get('first'),
    snapshot = adapter.snapshot.bind(adapter);
  adapter.snapshot = async () => {
    entered();
    await gate;
    return snapshot();
  };
  const syncing = f.request('/sync', member, 'POST', {});
  await started;
  try {
    assert.equal(
      (await f.request(`/members/${member.user.id}/servers`, f.admin, 'PATCH', { panelIds: [] }))
        .status,
      409,
    );
  } finally {
    release();
    await syncing;
  }
  assert.equal(
    (await f.request(`/members/${member.user.id}/servers`, f.admin, 'PATCH', { panelIds: [] }))
      .status,
    200,
  );
});
test('v2 upgrade preserves existing members and grants only current servers once across restarts', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-grants-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'legacy.sqlite'),
    db = openDatabase(database),
    id = randomUUID();
  db.prepare(
    'INSERT INTO users(id,email,name,password_hash,role,max_clients,quota_gb,created_at,username) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run(id, 'old@example.com', 'Existing member', 'preserved-hash', 'reseller', 10, 100, 1, 'old');
  db.exec('DROP TABLE user_panels; PRAGMA user_version=2;');
  db.close();
  let app = await createApp({ ...config(), database });
  assert.deepEqual(
    app.db
      .prepare('SELECT panel_id FROM user_panels WHERE user_id=? ORDER BY panel_id')
      .all(id)
      .map((r) => r.panel_id),
    ['first', 'second'],
  );
  assert.equal(
    app.db.prepare('SELECT password_hash FROM users WHERE id=?').get(id).password_hash,
    'preserved-hash',
  );
  app.db.prepare('DELETE FROM user_panels WHERE user_id=? AND panel_id=?').run(id, 'second');
  app.db.close();
  app = await createApp({
    ...config(),
    database,
    panels: [...panels, { id: 'third', name: 'New', inbounds: [] }],
  });
  assert.deepEqual(
    app.db
      .prepare('SELECT panel_id FROM user_panels WHERE user_id=?')
      .all(id)
      .map((r) => r.panel_id),
    ['first'],
  );
  app.db.close();
});
