// Execute inside the built image, with /tmp mounted writable. No real credentials or panels.
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { runSetup } from './src/setup.js';
import { configFromEnv } from './src/config.js';
import { createApp } from './src/app.js';
let secret;
const answers = ['https://relay.example.com'];
await runSetup({
  runtimeFile: '/tmp/relaydesk/runtime.json',
  ask: async () => answers.shift(),
  print: (line) => {
    if (line.startsWith('Generated administrator password (shown once): '))
      secret = line.split(': ')[1];
  },
});
const app = await createApp(configFromEnv({ RELAYDESK_CONFIG: '/tmp/relaydesk/runtime.json' }));
app.server.listen(3210, '127.0.0.1');
await once(app.server, 'listening');
const base = 'http://127.0.0.1:3210';
const response = await fetch(`${base}/api/login`, {
  method: 'POST',
  headers: { Origin: 'https://relay.example.com', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: secret }),
});
assert.equal(response.status, 200);
const session = await response.json();
const panels = await fetch(`${base}/api/panels`, {
  headers: { Cookie: response.headers.get('set-cookie').split(';')[0] },
});
assert.equal(panels.status, 200);
assert.deepEqual((await panels.json()).panels, []);
assert.equal(session.user.username, 'admin');
assert.notEqual(process.getuid(), 0);
console.log('Container setup, restart, login and admin settings passed as an unprivileged user.');
app.server.closeAllConnections();
await new Promise((resolve) => app.server.close(resolve));
app.db.close();
