import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { openDatabase, audit } from './db.js';
import { loginName, password, hashPassword } from './security.js';

const login = loginName(process.argv[2]);
const path = resolve(process.env.DATABASE_PATH || './data/relaydesk.sqlite');
await access(path);
if (!process.stdin.isTTY)
  throw new Error(
    'Run this command in an interactive terminal. Passwords are never command-line arguments.',
  );
const output = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});
const input = createInterface({ input: process.stdin, output, terminal: true });
let secret;
try {
  process.stdout.write('New password (hidden): ');
  secret = password(await input.question(''));
  process.stdout.write('\nConfirm password (hidden): ');
  const confirmation = await input.question('');
  if (secret !== confirmation) throw new Error('Passwords do not match. Nothing changed.');
} finally {
  input.close();
  process.stdout.write('\n');
}
const hash = await hashPassword(secret);
const db = openDatabase(path);
try {
  const user = db.prepare('SELECT id FROM users WHERE COALESCE(username,email)=?').get(login);
  if (!user) throw new Error('Account not found.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    audit(db, user.id, 'password.reset_by_operator', user.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  console.log('Password updated. Existing sessions revoked.');
} finally {
  db.close();
}
