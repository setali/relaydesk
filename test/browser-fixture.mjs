// Local UI fixture: all upstream adapters are in-memory. Never use for deployment.
import { createApp } from '../src/app.js';
import { DemoPanel } from '../src/panel.js';
import { token } from '../src/security.js';
if (process.env.RELAYDESK_BROWSER_FIXTURE !== '1')
  throw new Error('Set RELAYDESK_BROWSER_FIXTURE=1 to run this disposable UI fixture.');
class FixturePanel extends DemoPanel {
  async discover() {
    return [
      { id: 1, name: 'Germany direct', protocol: 'vless' },
      { id: 2, name: 'Tunnel', protocol: 'vmess' },
    ];
  }
}
const password = token(),
  panels = new Map();
const { server, db } = await createApp(
  {
    database: ':memory:',
    demo: false,
    secure: false,
    origin: 'http://127.0.0.1:3211',
    adminEmail: 'operator@example.com',
    adminUsername: 'operator',
    adminPassword: password,
    panels: [],
  },
  {
    adapterFactory: (panel) => {
      if (!panels.has(panel.id)) panels.set(panel.id, new FixturePanel());
      return panels.get(panel.id);
    },
  },
);
server.listen(3211, '127.0.0.1', () =>
  console.log(
    `Disposable UI fixture: http://127.0.0.1:3211\nUsername: operator\nPassword: ${password}\nUse synthetic HTTPS panel URLs/tokens; all panel requests are simulated.`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () =>
    server.close(() => {
      db.close();
      process.exit(0);
    }),
  );
