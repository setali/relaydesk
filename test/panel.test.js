import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreeXUI } from '../src/panel.js';
import { configFromEnv } from '../src/config.js';

test('v2 adapter preserves base path, bearer auth and documented byte/millisecond units', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, ...init });
    return new Response(
      JSON.stringify({
        success: true,
        obj: url.endsWith('/list')
          ? [{ id: 7, protocol: 'vless', settings: '{"clients":[]}', clientStats: [] }]
          : null,
      }),
    );
  });
  const panel = new ThreeXUI({
    baseUrl: 'https://panel.example/secret/',
    token: 'not-a-real-token',
  });
  const client = {
    uuid: 'test-id',
    remote_email: 'rd-test',
    inbound_id: 7,
    enabled: 1,
    quota_gb: 50,
    expires_at: 1900000000000,
    sub_id: 'sub',
  };
  await panel.create(client);
  await panel.remove(client);
  assert.equal(requests[0].url, 'https://panel.example/secret/panel/api/inbounds/list');
  assert.equal(requests[1].headers.Authorization, 'Bearer not-a-real-token');
  assert.equal(requests[1].redirect, 'error');
  const body = JSON.parse(requests[1].body),
    remote = JSON.parse(body.settings).clients[0];
  assert.equal(body.id, 7);
  assert.equal(remote.totalGB, 50 * 1024 ** 3);
  assert.equal(remote.expiryTime, client.expires_at);
  assert.equal(requests[2].url.endsWith('/7/delClient/test-id'), true);
});

test('adapter rejects malformed responses and unsupported protocols before writes', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          obj: [{ id: 1, protocol: 'shadowsocks', settings: '{"clients":[]}' }],
        }),
      ),
  );
  const panel = new ThreeXUI({ baseUrl: 'https://example.com', token: 'token' });
  await assert.rejects(panel.create({ inbound_id: 1 }), /VLESS and VMess/);
  globalThis.fetch = async () => new Response(JSON.stringify({ success: true, obj: {} }));
  await assert.rejects(panel.snapshot(), /Unsupported panel response/);
});

test('live configuration rejects unsafe URLs and ambiguous template IDs', () => {
  assert.throws(() => configFromEnv({ PUBLIC_ORIGIN: 'http://example.com' }), /https/i);
  const env = {
    PUBLIC_ORIGIN: 'https://relay.example.com',
    PANELS_JSON: JSON.stringify([
      {
        id: 'de',
        name: 'Germany',
        baseUrl: 'http://panel.example',
        token: 'token',
        inbounds: [{ id: 1, name: 'Direct' }],
      },
    ]),
  };
  assert.throws(() => configFromEnv(env), /HTTPS/);
  const panel = {
    id: 'de',
    name: 'Germany',
    baseUrl: 'https://panel.example',
    token: 'token',
    subscriptionBaseUrl: 'javascript:alert(1)',
    inbounds: [{ id: 1, name: 'Direct' }],
  };
  assert.throws(() => configFromEnv({ ...env, PANELS_JSON: JSON.stringify([panel]) }), /HTTPS/);
  delete panel.subscriptionBaseUrl;
  assert.throws(
    () => configFromEnv({ ...env, PANELS_JSON: JSON.stringify([panel, panel]) }),
    /duplicate/,
  );
  assert.equal(configFromEnv({ ...env, PANELS_JSON: JSON.stringify([panel]) }).panels.length, 1);
});
test('snapshot ignores unapproved tunnel inbounds with no client collection', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          success: true,
          obj: [
            { id: 1, protocol: 'vless', settings: '{"clients":[]}', clientStats: [] },
            { id: 2, protocol: 'dokodemo-door', settings: '{}' },
          ],
        }),
      ),
  );
  const panel = new ThreeXUI({
    baseUrl: 'https://panel.example',
    token: 'token',
    inbounds: [{ id: 1 }],
  });
  assert.deepEqual(
    (await panel.snapshot()).map((row) => row.id),
    [1],
  );
});
