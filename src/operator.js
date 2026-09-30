import { DatabaseSync } from 'node:sqlite';
import { readFileSync, accessSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { assert, loginName, password, token, hashPassword } from './security.js';
import { audit } from './db.js';

export async function operate({ command, database, runtimeFile, ask, print }) {
  accessSync(database);
  const db = new DatabaseSync(database, { readOnly: command === 'info' });
  try {
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    assert(
      schema === 3,
      409,
      'Unsupported database version. Use the matching application release.',
    );
    if (command === 'info') {
      const runtime = JSON.parse(readFileSync(runtimeFile, 'utf8'));
      const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
      print(`Relaydesk ${pkg.version}\nPanel: ${runtime.origin}\nDatabase schema: ${schema}`);
      const users = db.prepare('SELECT username,role FROM users ORDER BY created_at').all();
      for (const user of users)
        print(`Account: ${user.username} (${user.role === 'admin' ? 'administrator' : 'member'})`);
      print(`Connected servers: ${db.prepare('SELECT count(*) AS n FROM panels').get().n}`);
      print('Passwords cannot be displayed. Use relaydesk reset-password to replace one.');
      return;
    }
    assert(
      ['reset-password', 'change-username'].includes(command),
      400,
      'Unknown account command.',
    );
    const admins = db
      .prepare("SELECT username FROM users WHERE role='admin' ORDER BY created_at")
      .all();
    const defaultLogin = admins.length === 1 ? admins[0].username : '';
    print(
      'Accounts: ' +
        db
          .prepare('SELECT username FROM users ORDER BY created_at')
          .all()
          .map((u) => u.username)
          .join(', '),
    );
    const login = loginName(
      (await ask(`Account${defaultLogin ? ` [${defaultLogin}]` : ''}: `)).trim() || defaultLogin,
    );
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(login);
    assert(user, 404, 'Account not found. Nothing changed.');
    let generated = false,
      secret,
      newLogin = login;
    if (command === 'reset-password') {
      const entered = await ask('New password (hidden; Enter generates a secure password): ', true);
      generated = entered === '';
      secret = generated ? token() : password(entered);
      if (!generated)
        assert(
          secret === (await ask('Confirm new password (hidden): ', true)),
          400,
          'Passwords do not match. Nothing changed.',
        );
    } else {
      newLogin = loginName((await ask('New username: ')).trim());
      assert(
        !db
          .prepare('SELECT id FROM users WHERE (username=? OR email=?) AND id!=?')
          .get(newLogin, newLogin, user.id),
        409,
        'Username already in use. Nothing changed.',
      );
    }
    const accepted = (await ask(`Update ${login} and sign out its existing sessions? [Y/n]: `))
      .trim()
      .toLowerCase();
    if (accepted !== '' && accepted !== 'y') {
      print('Cancelled. Nothing changed.');
      return;
    }
    const hash = secret ? await hashPassword(secret) : user.password_hash;
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    try {
      const result = db
        .prepare(
          'UPDATE users SET username=?,password_hash=? WHERE id=? AND username=? AND password_hash=?',
        )
        .run(newLogin, hash, user.id, user.username, user.password_hash);
      assert(result.changes === 1, 409, 'Account changed concurrently. Retry.');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
      audit(
        db,
        user.id,
        command === 'reset-password'
          ? 'password.reset_by_operator'
          : 'username.changed_by_operator',
        user.id,
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    print(`Account updated. Username: ${newLogin}. Existing sessions revoked.`);
    if (generated) print(`Generated password (shown once): ${secret}`);
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const command = process.argv[2];
  let input,
    hidden = false,
    ended = false;
  try {
    assert(
      process.argv.length === 3,
      400,
      'Usage: operator.js info|reset-password|change-username. Never pass passwords as arguments.',
    );
    if (command !== 'info') {
      assert(process.stdin.isTTY, 400, 'Run account recovery in an interactive terminal.');
      const output = new Writable({
        write(chunk, encoding, callback) {
          if (!hidden) process.stdout.write(chunk, encoding);
          callback();
        },
      });
      input = createInterface({ input: process.stdin, output, terminal: true });
      input.on('close', () => {
        ended = true;
      });
      input.on('SIGINT', () => {
        input.close();
        process.exit(130);
      });
    }
    await operate({
      command,
      database: process.env.DATABASE_PATH || '/app/data/relaydesk.sqlite',
      runtimeFile: process.env.RELAYDESK_CONFIG || '/app/data/runtime.json',
      print: (message) => console.log(message),
      ask: async (prompt, secret = false) => {
        assert(!ended, 400, 'Input ended. Nothing changed.');
        hidden = secret;
        if (secret) process.stdout.write(prompt);
        try {
          const result = await input.question(secret ? '' : prompt);
          assert(!ended, 400, 'Input ended. Nothing changed.');
          return result;
        } finally {
          hidden = false;
          if (secret) process.stdout.write('\n');
        }
      },
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    input?.close();
  }
}
