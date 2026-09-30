import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, audit } from './db.js';
import { ThreeXUI, DemoPanel } from './panel.js';
import { PanelStore } from './panel-store.js';
import { settingsRoutes } from './settings.js';
import { certificateStatus } from './https-status.js';
import {
  assert,
  HttpError,
  token,
  digest,
  cookieToken,
  hashPassword,
  verifyPassword,
  email,
  password,
  integer,
  loginName,
} from './security.js';

const assets = new Map([
  ['/', ['index.html', 'text/html']],
  ['/app.js', ['app.js', 'text/javascript']],
  ['/settings.js', ['settings.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
]);
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const safeUser = ({ password_hash, ...user }) => user;
const text = (value, label) => {
  assert(
    typeof value === 'string' && value.trim().length >= 1 && value.length <= 80,
    400,
    `${label} must contain 1–80 characters.`,
  );
  return value.trim();
};
async function jsonBody(req) {
  assert(
    req.headers['content-type']?.split(';')[0] === 'application/json',
    415,
    'Expected application/json.',
  );
  let body = '',
    bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    assert(bytes <= 16384, 413, 'Request is too large.');
    body += chunk;
  }
  try {
    const data = JSON.parse(body);
    assert(
      data && !Array.isArray(data) && typeof data === 'object',
      400,
      'Expected a JSON object.',
    );
    return data;
  } catch {
    throw new HttpError(400, 'Invalid JSON request.');
  }
}

export async function createApp(config, overrides = {}) {
  const getCertificateStatus = certificateStatus(
    config.origin,
    config.demo,
    overrides.inspectCertificate,
  );
  const db = openDatabase(config.database);
  const mode = config.demo ? 'demo' : 'live';
  const previousMode = db.prepare("SELECT value FROM metadata WHERE key='mode'").get()?.value;
  assert(
    !previousMode || previousMode === mode,
    500,
    'Demo and live mode must use separate databases.',
  );
  db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES('mode',?)").run(mode);
  const store = new PanelStore(db, config);
  if (!config.demo) {
    store.importLegacy(config.panels);
    config.panels = store.all();
  }
  const adapters = new Map(
    config.panels.map((panel) => [
      panel.id,
      overrides.adapters?.get(panel.id) || (config.demo ? new DemoPanel() : new ThreeXUI(panel)),
    ]),
  );
  if (!db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    const adminEmail = email(config.adminEmail);
    const hash = await hashPassword(password(config.adminPassword));
    db.prepare(
      'INSERT INTO users(id,email,name,password_hash,role,max_clients,quota_gb,created_at,username) VALUES(?,?,?,?,?,?,?,?,?)',
    ).run(
      randomUUID(),
      adminEmail,
      'Workspace owner',
      hash,
      'admin',
      10000,
      1000000,
      Date.now(),
      loginName(config.adminUsername || adminEmail),
    );
  }
  db.prepare("UPDATE clients SET status='review' WHERE status='pending'").run();
  if (config.demo) {
    for (const row of db.prepare("SELECT * FROM clients WHERE status != 'deleted'").all())
      await adapters.get(row.panel_id)?.create(row);
  }
  const dummyHash = await hashPassword(token());
  const attempts = new Map();
  const busy = new Set();
  const handleSettings = settingsRoutes({
    db,
    config,
    store,
    adapters,
    busy,
    jsonBody,
    adapterFactory: overrides.adapterFactory,
  });
  const sessionSeconds = 8 * 3600;
  function auth(req) {
    const raw = cookieToken(req);
    const session =
      raw &&
      db
        .prepare('SELECT * FROM sessions WHERE hash=? AND expires_at>?')
        .get(digest(raw), Date.now());
    assert(session, 401, 'Sign in to continue.');
    return { user: db.prepare('SELECT * FROM users WHERE id=?').get(session.user_id), session };
  }
  const findClient = (id, user) => {
    const row = db.prepare("SELECT * FROM clients WHERE id=? AND status!='deleted'").get(id);
    assert(row && (user.role === 'admin' || row.owner_id === user.id), 404, 'Client not found.');
    return row;
  };
  function templates() {
    return config.panels.flatMap((p) =>
      p.inbounds.map((i) => ({ panelId: p.id, inboundId: i.id, name: i.name, server: p.name })),
    );
  }
  function viewClient(row) {
    const panel = config.panels.find((p) => p.id === row.panel_id);
    // Subscription origin is optional and configured by the operator, never derived from the admin panel URL.
    const subscriptionUrl =
      panel?.subscriptionBaseUrl && row.status === 'active'
        ? `${panel.subscriptionBaseUrl.replace(/\/$/, '')}/${encodeURIComponent(row.sub_id)}`
        : null;
    const { uuid, sub_id, remote_email, ...safe } = row;
    return {
      ...safe,
      subscriptionUrl,
      template:
        panel?.inbounds.find((i) => i.id === row.inbound_id)?.name || 'Unavailable template',
    };
  }
  const cookie = (value, age) =>
    `relaydesk=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${config.secure ? '; Secure' : ''}`;
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    res.setHeader('Cache-Control', 'no-store');
    if (config.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    function send(data, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    }
    try {
      const path = new URL(req.url, config.origin).pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [file, mime] = assets.get(path);
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
        res.end(await readFile(publicDir + file));
        return;
      }
      if (path === '/healthz' && req.method === 'GET') {
        send({ status: 'ok' });
        return;
      }
      const mutation = !['GET', 'HEAD'].includes(req.method);
      if (mutation)
        assert(req.headers.origin === config.origin, 403, 'Request origin is not allowed.');
      if (path === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
        const entry = attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
        assert(
          entry.count < 10 && attempts.size < 10000,
          429,
          'Too many login attempts. Try again in 15 minutes.',
        );
        entry.count++;
        attempts.set(ip, entry);
        const body = await jsonBody(req);
        const login = loginName(body.username || body.email);
        assert(
          typeof body.password === 'string' && body.password.length <= 128,
          400,
          'Invalid password.',
        );
        const user = db.prepare('SELECT * FROM users WHERE COALESCE(username,email)=?').get(login);
        const valid = await verifyPassword(body.password, user?.password_hash || dummyHash);
        assert(user && valid, 401, 'Email or password is incorrect.');
        const currentAccount = db
          .prepare('SELECT password_hash,username FROM users WHERE id=?')
          .get(user.id);
        assert(
          currentAccount?.password_hash === user.password_hash &&
            currentAccount?.username === user.username,
          401,
          'Credentials changed. Try again.',
        );
        attempts.delete(ip);
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
        const raw = token(),
          csrf = token();
        db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
          digest(raw),
          user.id,
          csrf,
          now + sessionSeconds * 1000,
        );
        res.setHeader('Set-Cookie', cookie(raw, sessionSeconds));
        audit(db, user.id, 'session.created', user.id);
        send({ user: safeUser(user), csrf, demo: config.demo });
        return;
      }
      const { user, session } = auth(req);
      if (mutation)
        assert(
          req.headers['x-csrf-token'] === session.csrf,
          403,
          'Session verification failed. Refresh and retry.',
        );
      if (path === '/api/me' && req.method === 'GET') {
        send({ user: safeUser(user), csrf: session.csrf, demo: config.demo });
        return;
      }
      if (await handleSettings({ path, req, user, send })) return;
      if (path === '/api/https' && req.method === 'GET') {
        assert(user.role === 'admin', 403, 'Only the workspace owner can inspect HTTPS.');
        send(await getCertificateStatus());
        return;
      }
      if (path === '/api/logout' && req.method === 'POST') {
        db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
        res.setHeader('Set-Cookie', cookie('', 0));
        send({ ok: true });
        return;
      }
      if (path === '/api/workspace' && req.method === 'GET') {
        const clients =
          user.role === 'admin'
            ? db
                .prepare("SELECT * FROM clients WHERE status!='deleted' ORDER BY created_at DESC")
                .all()
            : db
                .prepare(
                  "SELECT * FROM clients WHERE owner_id=? AND status!='deleted' ORDER BY created_at DESC",
                )
                .all(user.id);
        const users =
          user.role === 'admin'
            ? db.prepare('SELECT * FROM users ORDER BY created_at').all().map(safeUser)
            : [safeUser(user)];
        const events =
          user.role === 'admin'
            ? db
                .prepare(
                  'SELECT a.*, u.name AS actor FROM audit a JOIN users u ON a.actor_id=u.id ORDER BY a.id DESC LIMIT 30',
                )
                .all()
            : db
                .prepare(
                  'SELECT a.*, u.name AS actor FROM audit a JOIN users u ON a.actor_id=u.id WHERE actor_id=? ORDER BY a.id DESC LIMIT 30',
                )
                .all(user.id);
        send({ clients: clients.map(viewClient), users, templates: templates(), events });
        return;
      }
      if (path === '/api/resellers' && req.method === 'POST') {
        assert(user.role === 'admin', 403, 'Only the workspace owner can create team members.');
        const body = await jsonBody(req);
        const login = email(body.email),
          name = text(body.name, 'Name');
        const max = integer(body.maxClients, 1, 10000, 'Client limit'),
          quota = integer(body.quotaGB, 1, 1000000, 'Allocated quota');
        const hash = await hashPassword(password(body.password));
        assert(
          !db.prepare('SELECT id FROM users WHERE email=? OR username=?').get(login, login),
          409,
          'This email already has an account.',
        );
        const id = randomUUID();
        db.prepare(
          'INSERT INTO users(id,email,name,password_hash,role,max_clients,quota_gb,created_at,username) VALUES(?,?,?,?,?,?,?,?,?)',
        ).run(id, login, name, hash, 'reseller', max, quota, Date.now(), login);
        audit(db, user.id, 'reseller.created', id);
        send({ id }, 201);
        return;
      }
      if (path === '/api/clients' && req.method === 'POST') {
        const body = await jsonBody(req);
        assert(
          typeof body.requestId === 'string' && /^[0-9a-f-]{36}$/.test(body.requestId),
          400,
          'A request ID is required.',
        );
        const ownerId = user.role === 'admin' ? body.ownerId || user.id : user.id;
        const previous = db.prepare('SELECT * FROM clients WHERE id=?').get(body.requestId);
        if (previous) {
          assert(
            previous.owner_id === ownerId &&
              (user.role === 'admin' || previous.owner_id === user.id),
            409,
            'Request ID already used.',
          );
          send({ client: viewClient(previous) });
          return;
        }
        const owner = db.prepare('SELECT * FROM users WHERE id=?').get(ownerId);
        assert(owner, 400, 'Unknown account.');
        const name = text(body.name, 'Client name'),
          quota = integer(body.quotaGB, 1, 1000000, 'Quota'),
          days = integer(body.days, 1, 365, 'Duration');
        assert(
          templates().some((t) => t.panelId === body.panelId && t.inboundId === body.inboundId),
          400,
          'Select an approved template.',
        );
        // No await between checking capacity and reserving it: one SQLite writer owns allocation.
        const used = db
          .prepare(
            "SELECT count(*) AS count, COALESCE(sum(quota_gb),0) AS quota FROM clients WHERE owner_id=? AND status!='deleted'",
          )
          .get(ownerId);
        assert(
          used.count < owner.max_clients && used.quota + quota <= owner.quota_gb,
          409,
          'This account does not have enough client slots or allocated quota.',
        );
        const id = body.requestId,
          now = Date.now();
        db.prepare(
          'INSERT INTO clients(id,owner_id,name,panel_id,inbound_id,remote_email,uuid,sub_id,quota_gb,expires_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        ).run(
          id,
          ownerId,
          name,
          body.panelId,
          body.inboundId,
          `rd-${id}`,
          randomUUID(),
          token(),
          quota,
          now + days * 86400000,
          'pending',
          now,
        );
        const client = db.prepare('SELECT * FROM clients WHERE id=?').get(id);
        busy.add(id);
        try {
          await adapters.get(client.panel_id).create(client);
          db.prepare("UPDATE clients SET status='active' WHERE id=?").run(id);
          audit(db, user.id, 'client.created', id);
        } catch {
          db.prepare("UPDATE clients SET status='review' WHERE id=?").run(id);
          audit(db, user.id, 'client.needs_review', id);
          throw new HttpError(
            502,
            'Panel did not confirm creation. Capacity is reserved. Sync to reconcile before retrying.',
          );
        } finally {
          busy.delete(id);
        }
        send({ client: viewClient(db.prepare('SELECT * FROM clients WHERE id=?').get(id)) }, 201);
        return;
      }
      const match = path.match(/^\/api\/clients\/([0-9a-f-]{36})$/);
      if (match && req.method === 'DELETE') {
        const client = findClient(match[1], user);
        assert(!busy.has(client.id), 409, 'This client has an operation in progress.');
        assert(
          adapters.has(client.panel_id),
          409,
          'Restore the server configuration before removing this client.',
        );
        busy.add(client.id);
        try {
          const adapter = adapters.get(client.panel_id);
          const snapshot = await adapter.snapshot();
          const inbound = snapshot.find((i) => i.id === client.inbound_id);
          assert(inbound, 502, 'Inbound was not found. Check server configuration.');
          if (inbound.clients.some((c) => c.id === client.uuid && c.email === client.remote_email))
            await adapter.remove(client);
          // Verify remote absence before releasing capacity, including after previous timeouts.
          const after = (await adapter.snapshot()).find((i) => i.id === client.inbound_id);
          assert(
            after &&
              !after.clients.some((c) => c.id === client.uuid || c.email === client.remote_email),
            502,
            'Panel did not confirm removal.',
          );
          db.prepare("UPDATE clients SET status='deleted',enabled=0 WHERE id=?").run(client.id);
          audit(db, user.id, 'client.deleted', client.id);
          send({ ok: true });
        } catch {
          db.prepare("UPDATE clients SET status='review' WHERE id=?").run(client.id);
          throw new HttpError(
            502,
            'Removal could not be confirmed. Capacity remains reserved; sync and retry.',
          );
        } finally {
          busy.delete(client.id);
        }
        return;
      }
      if (path === '/api/sync' && req.method === 'POST') {
        const syncKey = `sync:${user.id}`;
        assert(!busy.has(syncKey), 409, 'A sync is already in progress.');
        busy.add(syncKey);
        const results = [];
        try {
          for (const [id, adapter] of adapters) {
            try {
              const rows = await adapter.snapshot();
              const clients = db
                .prepare("SELECT * FROM clients WHERE panel_id=? AND status!='deleted'")
                .all(id)
                .filter((c) => user.role === 'admin' || c.owner_id === user.id);
              for (const client of clients) {
                if (busy.has(client.id)) continue;
                const inbound = rows.find((r) => r.id === client.inbound_id);
                const exists = inbound?.clients.some(
                  (c) => c.id === client.uuid && c.email === client.remote_email,
                );
                if (!exists) {
                  db.prepare("UPDATE clients SET status='review' WHERE id=?").run(client.id);
                  continue;
                }
                const stats = inbound.traffic.find((c) => c.email === client.remote_email);
                if (
                  stats &&
                  [stats.up, stats.down].every((n) => Number.isSafeInteger(n) && n >= 0)
                ) {
                  db.prepare(
                    "UPDATE clients SET up=?,down=?,enabled=?,status='active',synced_at=? WHERE id=?",
                  ).run(
                    stats.up,
                    stats.down,
                    stats.enable === false ? 0 : 1,
                    Date.now(),
                    client.id,
                  );
                } else db.prepare("UPDATE clients SET status='active' WHERE id=?").run(client.id);
              }
              results.push({ panel: id, ok: true });
            } catch {
              results.push({ panel: id, ok: false });
            }
          }
        } finally {
          busy.delete(syncKey);
        }
        audit(db, user.id, 'usage.synced', user.id);
        send({ results });
        return;
      }
      throw new HttpError(404, 'Not found.');
    } catch (error) {
      if (!res.headersSent)
        send(
          { error: error.status ? error.message : 'An unexpected error occurred.' },
          error.status || 500,
        );
      else res.end();
      if (!error.status) console.error('Request failed:', error.name);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return { server, db, adapters };
}
