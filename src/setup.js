import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { configFromEnv } from './config.js';
import { token } from './security.js';
import { detectPublicIPv4, publicIPv4 } from './public-ip.js';

export async function runSetup({
  ask,
  print,
  runtimeFile,
  host = '127.0.0.1',
  detectAddress = async () => '',
}) {
  const file = resolve(runtimeFile),
    directory = dirname(file),
    database = join(directory, 'relaydesk.sqlite');
  if (existsSync(file) || existsSync(database))
    throw new Error(
      'An installation already exists here. Use Settings to change credentials or servers. Setup never overwrites an existing database.',
    );
  print('Relaydesk setup · independent login, encrypted panel credentials');
  let defaultAddress = '';
  try {
    defaultAddress = publicIPv4(await detectAddress());
  } catch {
    /* Manual input remains available. */
  }
  if (defaultAddress)
    print(
      `Detected public IPv4: ${defaultAddress}. Press Enter to use it, or enter another IP/domain. Behind NAT, verify this address reaches this server.`,
    );
  else print('Public IPv4 could not be detected. Enter your server IP or domain manually.');
  let origin;
  // Empty or malformed input is recoverable, before collecting credentials or writing data.
  for (;;) {
    const answer =
      (
        await ask(
          `Panel address: domain or public IPv4${defaultAddress ? ` [${defaultAddress}]` : ''}: `,
        )
      ).trim() || defaultAddress;
    if (!answer) {
      print('Enter a domain or IP address. This cannot be blank.');
      continue;
    }
    origin = answer.includes('://') ? answer : `https://${answer}`;
    try {
      configFromEnv({ PUBLIC_ORIGIN: origin, PANELS_JSON: '[]' });
      break;
    } catch {
      print(
        'Enter a valid HTTPS address without a path, query or trailing slash. Domain or IP is accepted.',
      );
    }
  }
  const username = 'admin';
  const contact = 'admin@relaydesk.local';
  const secret = token();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const config = configFromEnv({
    PUBLIC_ORIGIN: origin,
    HOST: host,
    PORT: '3210',
    DATABASE_PATH: database,
    ADMIN_EMAIL: contact,
    ADMIN_USERNAME: username,
    ADMIN_PASSWORD: secret,
    PANELS_JSON: '[]',
  });
  const { db } = await createApp(config);
  db.close();
  const runtime = { origin, host, port: 3210, database };
  const pending = `${file}.pending`;
  writeFileSync(pending, JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  renameSync(pending, file);
  print(`Setup complete. Username: ${username}`);
  print(`Generated administrator password (shown once): ${secret}`);
  print(
    `URL: ${origin}\nFinish HTTPS setup, then sign in and use Settings → Connect server to add your 3x-ui panels. Change credentials under Settings.`,
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
      detectAddress: detectPublicIPv4,
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
