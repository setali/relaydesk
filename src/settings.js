import { assert, loginName, password, hashPassword, verifyPassword } from './security.js';
import { audit } from './db.js';
import { publicPanel, validatePanel } from './panel-store.js';
import { ThreeXUI } from './panel.js';

export function settingsRoutes({
  db,
  config,
  store,
  adapters,
  busy,
  jsonBody,
  adapterFactory = (panel) => new ThreeXUI(panel),
}) {
  const credentialAttempts = new Map();
  const locked = new Set();
  function reload() {
    config.panels = store.all();
    adapters.clear();
    for (const panel of config.panels) adapters.set(panel.id, adapterFactory(panel));
  }
  return async ({ path, req, user, send }) => {
    if (path === '/api/account' && req.method === 'PATCH') {
      const now = Date.now();
      for (const [id, entry] of credentialAttempts)
        if (entry.until < now) credentialAttempts.delete(id);
      const attempt = credentialAttempts.get(user.id) || { count: 0, until: now + 15 * 60000 };
      assert(attempt.count < 5, 429, 'Too many password checks. Try again in 15 minutes.');
      attempt.count++;
      credentialAttempts.set(user.id, attempt);
      const body = await jsonBody(req);
      assert(
        typeof body.currentPassword === 'string' && body.currentPassword.length <= 128,
        400,
        'Current password is required.',
      );
      assert(
        await verifyPassword(body.currentPassword, user.password_hash),
        403,
        'Current password is incorrect.',
      );
      const username = loginName(body.username),
        name = body.name;
      assert(
        typeof name === 'string' && name.trim() && name.length <= 80,
        400,
        'Name must contain 1–80 characters.',
      );
      const hash = body.newPassword
        ? await hashPassword(password(body.newPassword))
        : user.password_hash;
      assert(
        !db
          .prepare('SELECT id FROM users WHERE (username=? OR email=?) AND id!=?')
          .get(username, username, user.id),
        409,
        'This username is already in use.',
      );
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = db
          .prepare(
            'UPDATE users SET username=?,name=?,password_hash=? WHERE id=? AND password_hash=?',
          )
          .run(username, name.trim(), hash, user.id, user.password_hash);
        assert(result.changes === 1, 409, 'Credentials changed in another session. Sign in again.');
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        audit(db, user.id, 'account.updated', user.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      credentialAttempts.delete(user.id);
      send({ ok: true, signInRequired: true });
      return true;
    }
    if (!path.startsWith('/api/panels')) return false;
    assert(user.role === 'admin', 403, 'Only administrators can manage servers.');
    if (path === '/api/panels' && req.method === 'GET') {
      send({ panels: config.panels.map(publicPanel), demo: config.demo });
      return true;
    }
    assert(
      !config.demo,
      409,
      'Live server settings are unavailable in demo mode. Use the installer for a persistent workspace.',
    );
    assert(!locked.has('panels'), 409, 'A server operation is already running.');
    locked.add('panels');
    try {
      const match = path.match(/^\/api\/panels\/([a-z0-9-]{1,40})$/);
      if (match && req.method === 'DELETE') {
        const id = match[1];
        assert(
          config.panels.some((p) => p.id === id),
          404,
          'Server not found.',
        );
        assert(
          !db
            .prepare("SELECT id FROM clients WHERE panel_id=? AND status!='deleted' LIMIT 1")
            .get(id),
          409,
          'Remove managed clients before removing this server.',
        );
        store.remove(id);
        db.prepare('DELETE FROM user_panels WHERE panel_id=?').run(id);
        reload();
        audit(db, user.id, 'server.removed', id);
        send({ ok: true });
        return true;
      }
      if (!['/api/panels', '/api/panels/probe'].includes(path) || req.method !== 'POST')
        return false;
      const body = await jsonBody(req),
        previous = config.panels.find((p) => p.id === body.id);
      const panel = validatePanel(body, previous);
      const clients = db
        .prepare("SELECT * FROM clients WHERE panel_id=? AND status!='deleted'")
        .all(panel.id);
      if (previous && clients.length) {
        assert(
          previous.baseUrl === panel.baseUrl,
          409,
          'A server with managed clients cannot be pointed at a different panel.',
        );
        if (path === '/api/panels')
          assert(
            clients.every((c) => panel.inbounds.some((i) => i.id === c.inbound_id)),
            409,
            'Keep every inbound that has managed clients.',
          );
      }
      assert(
        !clients.some((c) => busy.has(c.id)),
        409,
        'Wait for client operations to finish before changing this server.',
      );
      let discovered;
      try {
        discovered = await adapterFactory(panel).discover();
      } catch {
        assert(
          false,
          502,
          'Could not verify the inbound API. Check HTTPS, the full panel path, token permissions and version. Cookie-only and v3-only APIs are not supported yet.',
        );
      }
      if (path === '/api/panels/probe') {
        send({
          inbounds: discovered,
          contract: 'v2-inbounds',
          note: 'Read access verified. Client write compatibility still requires a disposable-client test.',
        });
        return true;
      }
      assert(panel.inbounds.length > 0, 400, 'Select at least one inbound.');
      assert(
        panel.inbounds.every((i) =>
          discovered.some((d) => d.id === i.id && (d.protocol === 'vless' || !i.flow)),
        ),
        400,
        'Choose supported inbounds from this server. Vision flow requires VLESS.',
      );
      // Recheck after the asynchronous probe: clients can be created while it runs.
      const current = db
        .prepare("SELECT * FROM clients WHERE panel_id=? AND status!='deleted'")
        .all(panel.id);
      assert(
        !previous || !current.length || previous.baseUrl === panel.baseUrl,
        409,
        'A server with managed clients cannot be pointed at a different panel.',
      );
      assert(
        !current.some((c) => busy.has(c.id)) &&
          current.every((c) => panel.inbounds.some((i) => i.id === c.inbound_id)),
        409,
        'Server usage changed. Reload and retry.',
      );
      store.save(panel);
      reload();
      audit(db, user.id, previous ? 'server.updated' : 'server.created', panel.id);
      send({ panel: publicPanel(panel) }, previous ? 200 : 201);
      return true;
    } finally {
      locked.delete('panels');
    }
  };
}
