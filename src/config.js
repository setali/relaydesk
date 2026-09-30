import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
export function configFromEnv(env = process.env) {
  if (env.RELAYDESK_CONFIG) {
    const saved = JSON.parse(readFileSync(env.RELAYDESK_CONFIG, 'utf8'));
    env = {
      PUBLIC_ORIGIN: saved.origin,
      HOST: saved.host,
      PORT: String(saved.port),
      DATABASE_PATH: saved.database,
      ...env,
    };
  }
  const demo = env.DEMO_MODE === 'true';
  const origin = env.PUBLIC_ORIGIN || 'http://127.0.0.1:3210';
  const url = new URL(origin);
  if (url.origin !== origin)
    throw new Error('PUBLIC_ORIGIN must be an exact origin without a trailing slash.');
  if (!demo && url.protocol !== 'https:')
    throw new Error('Live mode requires PUBLIC_ORIGIN=https://… behind a TLS reverse proxy.');
  const panels = demo
    ? [
        {
          id: 'demo',
          name: 'Demo network',
          inbounds: [
            { id: 1, name: 'Germany · Direct' },
            { id: 2, name: 'Iran → Germany · Tunnel' },
          ],
        },
      ]
    : JSON.parse(env.PANELS_JSON || '[]');
  const ids = new Set();
  for (const panel of panels) {
    if (
      !/^[a-z0-9-]{1,40}$/.test(panel.id) ||
      ids.has(panel.id) ||
      !panel.name ||
      !Array.isArray(panel.inbounds) ||
      !panel.inbounds.length
    )
      throw new Error('Invalid or duplicate panel configuration.');
    ids.add(panel.id);
    if (panel.subscriptionBaseUrl) {
      const subscription = new URL(panel.subscriptionBaseUrl);
      if (
        subscription.protocol !== 'https:' ||
        subscription.username ||
        subscription.password ||
        subscription.search ||
        subscription.hash
      )
        throw new Error('Subscription base URLs must use HTTPS.');
    }
    if (!demo) {
      const base = new URL(panel.baseUrl);
      if (
        base.protocol !== 'https:' ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        !panel.token
      )
        throw new Error('Panels require HTTPS base URLs and a server-side API token.');
    }
    const inboundIds = new Set();
    for (const inbound of panel.inbounds) {
      if (
        !Number.isSafeInteger(inbound.id) ||
        inbound.id < 1 ||
        !inbound.name ||
        inboundIds.has(inbound.id)
      )
        throw new Error('Invalid or duplicate inbound template.');
      inboundIds.add(inbound.id);
    }
  }
  return {
    demo,
    origin,
    panels,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3210),
    database: resolve(env.DATABASE_PATH || './data/relaydesk.sqlite'),
    adminEmail: env.ADMIN_EMAIL,
    adminUsername: env.ADMIN_USERNAME,
    adminPassword: env.ADMIN_PASSWORD,
    encryptionKeyPath: env.ENCRYPTION_KEY_PATH,
    secure: url.protocol === 'https:',
  };
}
