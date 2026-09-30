import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { loginName, email, password, token } from './security.js';
import { ThreeXUI } from './panel.js';
import { validatePanel } from './panel-store.js';

export async function runSetup({
  ask,
  print,
  runtimeFile,
  discover = (panel) => new ThreeXUI(panel).discover(),
  host = '127.0.0.1',
}) {
  const file = resolve(runtimeFile),
    directory = dirname(file),
    database = join(directory, 'relaydesk.sqlite');
  if (existsSync(file) || existsSync(database))
    throw new Error(
      'An installation already exists here. Use Settings to change credentials or servers. Setup never overwrites an existing database.',
    );
  print('Relaydesk setup · independent login, encrypted panel credentials');
  const origin = (
    await ask('Public HTTPS origin (for example https://relay.example.com): ')
  ).trim();
  // Validate the origin before asking for secrets.
  configFromEnv({ PUBLIC_ORIGIN: origin, PANELS_JSON: '[]' });
  const username = loginName((await ask('Administrator username [admin]: ')).trim() || 'admin');
  const contact = email(
    (await ask('Administrator email [admin@relaydesk.local]: ')).trim() || 'admin@relaydesk.local',
  );
  const entered = await ask('Administrator password (12+ characters; blank generates one): ', true);
  const secret = entered ? password(entered) : token();
  if (entered && secret !== (await ask('Confirm administrator password: ', true)))
    throw new Error('Passwords do not match. No installation was created.');
  const panels = [];
  if ((await ask('Connect a 3x-ui server now? [y/N]: ')).trim().toLowerCase() === 'y') {
    print(
      'In token-capable 3x-ui releases: Panel Settings → API Tokens → create a token for Relaydesk.',
    );
    print(
      'Use the full HTTPS panel URL including its private base path. Cookie-only and v3-only APIs are not supported in this release.',
    );
    const id = (await ask('Server ID [primary]: ')).trim() || 'primary';
    const name = (await ask('Server display name [Primary server]: ')).trim() || 'Primary server';
    const baseUrl = (await ask('Full panel HTTPS URL: ')).trim();
    const apiToken = await ask('Panel API token (hidden): ', true);
    const subscriptionBaseUrl = (await ask('Subscription HTTPS base URL (optional): ')).trim();
    const panel = validatePanel({
      id,
      name,
      baseUrl,
      token: apiToken,
      subscriptionBaseUrl,
      inbounds: [],
    });
    let rows;
    try {
      rows = await discover(panel);
    } catch {
      throw new Error(
        'Panel verification failed. Check HTTPS, token permissions, the full URL and API version. Nothing was installed.',
      );
    }
    if (!rows.length)
      throw new Error('No supported VLESS/VMess inbounds were found. Nothing was installed.');
    for (const row of rows) print(`${row.id}: ${row.name} (${row.protocol})`);
    const selected = (await ask('Allowed inbound IDs, comma separated: '))
      .split(',')
      .map((value) => Number(value.trim()));
    if (
      !selected.length ||
      selected.some((id) => !rows.some((row) => row.id === id)) ||
      new Set(selected).size !== selected.length
    )
      throw new Error('Choose valid unique inbound IDs.');
    panel.inbounds = [];
    for (const id of selected) {
      const row = rows.find((r) => r.id === id);
      const flow =
        row.protocol === 'vless' &&
        (await ask(`Use Vision flow for inbound ${id}? [y/N]: `)).trim().toLowerCase() === 'y'
          ? 'xtls-rprx-vision'
          : '';
      panel.inbounds.push({ id, name: row.name, flow });
    }
    panels.push(validatePanel(panel));
    print(
      'Read access verified. Test one disposable client before using this panel in production.',
    );
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = configFromEnv({
    PUBLIC_ORIGIN: origin,
    HOST: host,
    PORT: '3210',
    DATABASE_PATH: database,
    ADMIN_EMAIL: contact,
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: secret,
    PANELS_JSON: JSON.stringify(panels),
  });
  const { db } = await createApp(config);
  db.close();
  const runtime = { origin, host, port: 3210, database };
  const pending = `${file}.pending`;
  writeFileSync(pending, JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(pending, file);
  print(`Setup complete. Username: ${username}`);
  if (!entered) print(`Generated administrator password (shown once): ${secret}`);
  print(
    `URL: ${origin}\nPut an HTTPS reverse proxy in front of the local port. Change credentials and manage servers under Settings.`,
  );
  return { file, username, origin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.stdin.isTTY)
    throw new Error(
      'Setup requires an interactive terminal. Run npm run setup or bash install.sh from a trusted checkout.',
    );
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!hidden) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  input.on('SIGINT', () => {
    input.close();
    process.exit(130);
  });
  try {
    await runSetup({
      runtimeFile: process.env.RELAYDESK_CONFIG || './data/runtime.json',
      host: process.env.HOST || '127.0.0.1',
      print: (message) => console.log(message),
      ask: async (prompt, secret = false) => {
        hidden = secret;
        if (secret) process.stdout.write(prompt);
        try {
          return await input.question(secret ? '' : prompt);
        } finally {
          if (secret) process.stdout.write('\n');
          hidden = false;
        }
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    input.close();
  }
}
