import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 2) {
    db.close();
    throw new Error('Database is newer than this application. Restore a compatible release.');
  }
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','reseller')),
      max_clients INTEGER NOT NULL, quota_gb INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
      panel_id TEXT NOT NULL, inbound_id INTEGER NOT NULL, remote_email TEXT UNIQUE NOT NULL,
      uuid TEXT NOT NULL, sub_id TEXT NOT NULL, quota_gb INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('pending','active','review','deleted')),
      created_at INTEGER NOT NULL, synced_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS clients_owner ON clients(owner_id,status);
    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
      target TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`ALTER TABLE users ADD COLUMN username TEXT;
        UPDATE users SET username=email;
        CREATE UNIQUE INDEX users_username ON users(username);
        CREATE TABLE panels(id TEXT PRIMARY KEY, settings TEXT NOT NULL, token_cipher TEXT NOT NULL, updated_at INTEGER NOT NULL);
        PRAGMA user_version=2;`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
export function audit(db, actor, action, target) {
  db.prepare('INSERT INTO audit(actor_id,action,target,created_at) VALUES(?,?,?,?)').run(
    actor,
    action,
    target,
    Date.now(),
  );
}
