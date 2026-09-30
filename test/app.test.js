import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { DemoPanel } from '../src/panel.js';
const origin = 'http://127.0.0.1:3210';
const password = 'a-private-test-password';
async function fixture(t, adapter = new DemoPanel()) {
  const app = await createApp(
    {
      database: ':memory:',
      demo: true,
      secure: false,
      origin,
      adminEmail: 'admin@example.com',
      adminPassword: password,
      panels: [{ id: 'demo', name: 'Demo', inbounds: [{ id: 1, name: 'Direct' }] }],
    },
    { adapters: new Map([['demo', adapter]]) },
  );
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise((resolve) => app.server.close(resolve));
    app.db.close();
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  async function request(path, { method = 'GET', body, session, headers = {} } = {}) {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json(), headers: res.headers };
  }
  async function login(email = 'admin@example.com') {
    const response = await request('/login', { method: 'POST', body: { email, password } });
    assert.equal(response.status, 200);
    return { cookie: response.headers.get('set-cookie').split(';')[0], ...response.data };
  }
  const admin = await login();
  async function reseller(email, maxClients = 2, quotaGB = 50) {
    const result = await request('/resellers', {
      method: 'POST',
      session: admin,
      body: { name: email, email, password, maxClients, quotaGB },
    });
    assert.equal(result.status, 201);
    return login(email);
  }
  const create = (session, extra = {}) =>
    request('/clients', {
      method: 'POST',
      session,
      body: {
        requestId: randomUUID(),
        name: 'My phone',
        panelId: 'demo',
        inboundId: 1,
        quotaGB: 20,
        days: 30,
        ...extra,
      },
    });
  return { ...app, request, login, admin, reseller, create, adapter };
}

test('HTTPS status is administrator-only and does not connect in demo mode', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/https')).status, 401);
  const member = await f.reseller('https-member@example.com');
  assert.equal((await f.request('/https', { session: member })).status, 403);
  const result = await f.request('/https', { session: f.admin });
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'demo');
});

test('sessions, origin and CSRF protect mutation; logout revokes the session', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/workspace')).status, 401);
  assert.equal(
    (
      await f.request('/sync', {
        method: 'POST',
        session: f.admin,
        headers: { Origin: 'https://evil.example' },
        body: {},
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request('/sync', {
        method: 'POST',
        session: f.admin,
        headers: { 'X-CSRF-Token': '' },
        body: {},
      })
    ).status,
    403,
  );
  const stored = f.db.prepare('SELECT hash FROM sessions').get();
  assert.notEqual(stored.hash, f.admin.cookie.slice(10));
  assert.equal(
    (await f.request('/logout', { method: 'POST', session: f.admin, body: {} })).status,
    200,
  );
  assert.equal((await f.request('/me', { session: f.admin })).status, 401);
});

test('resellers cannot read or remove another owner’s client, create accounts, or choose an owner', async (t) => {
  const f = await fixture(t),
    a = await f.reseller('a@example.com'),
    b = await f.reseller('b@example.com');
  const created = await f.create(a, { ownerId: b.user.id });
  assert.equal(created.status, 201);
  assert.equal(created.data.client.owner_id, a.user.id);
  const workspace = (await f.request('/workspace', { session: b })).data;
  assert.equal(workspace.clients.length, 0);
  assert.deepEqual(
    workspace.users.map((u) => u.id),
    [b.user.id],
  );
  assert.equal(
    (await f.request(`/clients/${created.data.client.id}`, { method: 'DELETE', session: b }))
      .status,
    404,
  );
  assert.equal(
    (await f.request('/resellers', { method: 'POST', session: b, body: {} })).status,
    403,
  );
  assert.equal((await f.create(b, { requestId: created.data.client.id })).status, 409);
  assert.equal(JSON.stringify(workspace).includes('password_hash'), false);
  assert.equal('uuid' in created.data.client, false);
});

test('concurrent allocation respects quota and request replay does not create a duplicate', async (t) => {
  const f = await fixture(t),
    reseller = await f.reseller('quota@example.com', 4, 30);
  const requestId = randomUUID();
  const results = await Promise.all([f.create(reseller, { requestId }), f.create(reseller)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const success = results.find((r) => r.status === 201);
  const replay = await f.create(reseller, { requestId: success.data.client.id });
  assert.equal(replay.status, 200);
  assert.equal(f.adapter.clients.size, 1);
  assert.equal((await f.create(reseller, { quotaGB: 1, inboundId: 999 })).status, 400);
});

test('ambiguous remote create keeps capacity reserved; sync reconciles and verified delete releases it', async (t) => {
  class UncertainPanel extends DemoPanel {
    async create(client) {
      await super.create(client);
      throw new Error('Response lost');
    }
  }
  const f = await fixture(t, new UncertainPanel()),
    reseller = await f.reseller('review@example.com', 1, 20);
  assert.equal((await f.create(reseller)).status, 502);
  const pending = f.db.prepare('SELECT * FROM clients').get();
  assert.equal(pending.status, 'review');
  assert.equal((await f.create(reseller)).status, 409);
  assert.equal(
    (await f.request('/sync', { method: 'POST', session: reseller, body: {} })).status,
    200,
  );
  assert.equal(f.db.prepare('SELECT status FROM clients').get().status, 'active');
  assert.equal(
    (await f.request(`/clients/${pending.id}`, { method: 'DELETE', session: reseller })).status,
    200,
  );
  assert.equal(f.db.prepare('SELECT status FROM clients').get().status, 'deleted');
  assert.equal(f.adapter.clients.size, 0);
});

test('failed delete does not release allocation or falsely report success', async (t) => {
  class FailedDelete extends DemoPanel {
    async remove() {
      throw new Error('Offline');
    }
  }
  const f = await fixture(t, new FailedDelete()),
    user = await f.reseller('delete@example.com', 1, 20);
  const { data } = await f.create(user);
  assert.equal(
    (await f.request(`/clients/${data.client.id}`, { method: 'DELETE', session: user })).status,
    502,
  );
  assert.equal((await f.create(user)).status, 409);
  assert.equal(f.adapter.clients.size, 1);
});

test('usage sync retains old data on outage and scopes writes to the requesting reseller', async (t) => {
  const f = await fixture(t),
    a = await f.reseller('usage-a@example.com'),
    b = await f.reseller('usage-b@example.com');
  const ca = (await f.create(a)).data.client,
    cb = (await f.create(b)).data.client;
  for (const value of f.adapter.clients.values()) {
    value.up = 100;
    value.down = 200;
  }
  await f.request('/sync', { method: 'POST', session: a, body: {} });
  assert.equal(f.db.prepare('SELECT down FROM clients WHERE id=?').get(ca.id).down, 200);
  assert.equal(f.db.prepare('SELECT down FROM clients WHERE id=?').get(cb.id).down, 0);
  f.adapter.snapshot = async () => {
    throw new Error('Offline');
  };
  const result = await f.request('/sync', { method: 'POST', session: a, body: {} });
  assert.equal(result.data.results[0].ok, false);
  assert.equal(f.db.prepare('SELECT down FROM clients WHERE id=?').get(ca.id).down, 200);
});

test('login throttling, input validation and security headers', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.create(f.admin, { quotaGB: -1 })).status, 400);
  assert.equal((await f.create(f.admin, { days: 999999 })).status, 400);
  const me = await f.request('/me', { session: f.admin });
  assert.match(me.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.request('/login', {
          method: 'POST',
          body: { email: 'admin@example.com', password: 'wrong' },
        })
      ).status,
      401,
    );
  assert.equal(
    (await f.request('/login', { method: 'POST', body: { email: 'admin@example.com', password } }))
      .status,
    429,
  );
});
