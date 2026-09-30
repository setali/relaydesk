import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDatabase } from '../src/db.js';
import { hashPassword, verifyPassword } from '../src/security.js';
import { operate } from '../src/operator.js';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-operator-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'db.sqlite'),
    runtimeFile = join(directory, 'runtime.json');
  writeFileSync(runtimeFile, JSON.stringify({ origin: 'https://relay.example.com' }));
  const db = openDatabase(database),
    hash = await hashPassword('initial-test-password');
  db.prepare(
    'INSERT INTO users(id,email,name,password_hash,role,max_clients,quota_gb,created_at,username) VALUES(?,?,?,?,?,?,?,?,?)',
  ).run('owner', 'admin@example.com', 'Owner', hash, 'admin', 10, 100, 1, 'admin');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(
    'session',
    'owner',
    'csrf',
    Date.now() + 60000,
  );
  db.close();
  return { directory, database, runtimeFile, hash };
}
test('generated recovery password is shown once, hashed, and revokes sessions without losing accounts', async (t) => {
  const f = await fixture(t),
    output = [],
    answers = ['', '', ''];
  await operate({
    ...f,
    command: 'reset-password',
    ask: async () => answers.shift(),
    print: (s) => output.push(s),
  });
  const generated = output.filter((s) => s.startsWith('Generated password (shown once): '));
  assert.equal(generated.length, 1);
  const password = generated[0].split(': ')[1];
  const db = openDatabase(f.database);
  assert.match(password, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    await verifyPassword(
      password,
      db.prepare('SELECT password_hash FROM users').get().password_hash,
    ),
    true,
  );
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1);
  assert.equal(readFileSync(f.database).includes(Buffer.from(password)), false);
  db.close();
});
test('mismatch, cancellation and missing account preserve credentials and sessions', async (t) => {
  for (const answers of [
    ['admin', 'custom-test-password', 'different-password'],
    ['admin', '', 'n'],
    ['missing'],
  ]) {
    const f = await fixture(t),
      output = [];
    try {
      await operate({
        ...f,
        command: 'reset-password',
        ask: async () => answers.shift(),
        print: (s) => output.push(s),
      });
    } catch (error) {
      assert.match(error.message, /match|not found/);
    }
    const db = openDatabase(f.database);
    assert.equal(db.prepare('SELECT password_hash FROM users').get().password_hash, f.hash);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
    assert.equal(
      output.some((s) => s.startsWith('Generated password')),
      false,
    );
    db.close();
  }
});
test('custom password and username recovery work; info never displays secrets', async (t) => {
  const f = await fixture(t),
    output = [];
  let answers = ['', 'custom-test-password', 'custom-test-password', 'y'];
  const run = (command) =>
    operate({ ...f, command, ask: async () => answers.shift(), print: (s) => output.push(s) });
  await run('reset-password');
  answers = ['', 'owner', ''];
  await run('change-username');
  await run('info');
  const db = openDatabase(f.database),
    user = db.prepare('SELECT * FROM users').get();
  assert.equal(user.username, 'owner');
  assert.equal(await verifyPassword('custom-test-password', user.password_hash), true);
  assert.match(output.join('\n'), /Panel: https:\/\/relay.example.com/);
  assert.equal(output.join('\n').includes(user.password_hash), false);
  assert.equal(output.join('\n').includes('custom-test-password'), false);
  db.close();
});
test('operator never creates a missing database', async (t) => {
  const f = await fixture(t),
    database = join(f.directory, 'missing.sqlite');
  await assert.rejects(operate({ ...f, database, command: 'reset-password' }), /ENOENT/);
  assert.equal(existsSync(database), false);
});
test('management help needs no Docker; backup restores previous service state even on failure', (t) => {
  assert.equal(spawnSync('bash', ['install.sh', 'help']).status, 0);
  const directory = mkdtempSync(join(tmpdir(), 'relaydesk-cli-shell-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  copyFileSync('install.sh', join(directory, 'install.sh'));
  writeFileSync(join(directory, '.install.env'), 'RELAYDESK_HTTP_PORT=3210\n');
  writeFileSync(join(directory, 'package.json'), '{}');
  mkdirSync(join(directory, 'data'));
  writeFileSync(join(directory, 'data', 'master.key'), 'synthetic-key');
  writeFileSync(
    join(directory, 'docker'),
    `#!/bin/bash
printf '%s\\n' "$*" >> "$FIXTURE/calls"
case "$*" in
  *'ps --status running --services') [[ "$RUNNING" != yes ]] || echo relaydesk ;;
  *'--entrypoint tar'*) [[ "$FAIL_BACKUP" != yes ]] || exit 1; tar -C "$FIXTURE/data" -czf - . ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  for (const [running, fail] of [
    ['yes', 'no'],
    ['yes', 'yes'],
    ['no', 'no'],
  ]) {
    writeFileSync(join(directory, 'calls'), '');
    const result = spawnSync('bash', [join(directory, 'install.sh'), 'backup'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        FIXTURE: directory,
        RUNNING: running,
        FAIL_BACKUP: fail,
      },
    });
    assert.equal(result.status, fail === 'yes' ? 1 : 0, result.stderr);
    const calls = readFileSync(join(directory, 'calls'), 'utf8');
    assert.equal(calls.includes(' stop'), running === 'yes');
    assert.equal(calls.includes(' up -d --wait'), running === 'yes');
    if (fail === 'no') assert.match(result.stdout, /Backup complete:/);
  }
  const rejected = spawnSync(
    'bash',
    [join(directory, 'install.sh'), 'reset-password', 'plaintext-secret'],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE: directory },
    },
  );
  assert.notEqual(rejected.status, 0);
  assert.doesNotMatch(rejected.stderr, /plaintext-secret/);
});
