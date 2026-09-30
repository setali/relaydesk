import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { hashPassword, token } from './security.js';
const secret = token();
const config = configFromEnv({
  DEMO_MODE: 'true',
  PUBLIC_ORIGIN: 'http://127.0.0.1:3210',
  ADMIN_EMAIL: 'admin@relaydesk.local',
  ADMIN_PASSWORD: secret,
});
config.database = ':memory:';
const { server, db, adapters } = await createApp(config);
const owner = db.prepare("SELECT id FROM users WHERE role='admin'").get().id;
const reseller = randomUUID();
db.prepare(
  'INSERT INTO users(id,email,name,password_hash,role,max_clients,quota_gb,created_at) VALUES(?,?,?,?,?,?,?,?)',
).run(
  reseller,
  'studio@example.com',
  'North Studio',
  await hashPassword(token()),
  'reseller',
  20,
  500,
  Date.now(),
);
db.prepare('INSERT INTO user_panels(user_id,panel_id) VALUES(?,?)').run(reseller, 'demo');
for (const [index, name] of [
  'Personal MacBook',
  'Studio team',
  'Travel phone',
  'Family connection',
  'Work laptop',
].entries()) {
  const id = randomUUID(),
    user = index < 2 ? owner : reseller,
    quota = [100, 80, 30, 60, 50][index];
  db.prepare(
    'INSERT INTO clients(id,owner_id,name,panel_id,inbound_id,remote_email,uuid,sub_id,quota_gb,expires_at,status,created_at,up,down,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run(
    id,
    user,
    name,
    'demo',
    (index % 2) + 1,
    `rd-${id}`,
    randomUUID(),
    token(),
    quota,
    Date.now() + (index + 5) * 86400000,
    'active',
    Date.now() - index * 86400000,
    (index + 1) * 1024 ** 3,
    (index + 2) * 3 * 1024 ** 3,
    Date.now(),
  );
  await adapters.get('demo').create(db.prepare('SELECT * FROM clients WHERE id=?').get(id));
}
server.listen(config.port, config.host, () => {
  console.log(
    `\nRelaydesk demo: ${config.origin}\nEmail: ${config.adminEmail}\nOne-time password: ${secret}\n\nIn-memory sample data. No real panel connection.\n`,
  );
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
