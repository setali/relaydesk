import { assert } from './security.js';

export function panelAccess(db, config) {
  const allowed = (user, id) =>
    user.role === 'admin' ||
    (typeof id === 'string' &&
      !!db.prepare('SELECT 1 FROM user_panels WHERE user_id=? AND panel_id=?').get(user.id, id));
  const ids = (user) => config.panels.filter((p) => allowed(user, p.id)).map((p) => p.id);
  function validate(value) {
    assert(
      Array.isArray(value) &&
        value.length <= config.panels.length &&
        new Set(value).size === value.length &&
        value.every((id) => typeof id === 'string' && config.panels.some((p) => p.id === id)),
      400,
      'Select valid, unique servers. Use an empty list for no access.',
    );
    return value;
  }
  function replace(userId, panelIds) {
    db.prepare('DELETE FROM user_panels WHERE user_id=?').run(userId);
    for (const id of panelIds)
      db.prepare('INSERT INTO user_panels(user_id,panel_id) VALUES(?,?)').run(userId, id);
  }
  // Preserve only existing access once; newly added servers require explicit grants.
  if (!db.prepare("SELECT 1 FROM metadata WHERE key='panel_access_migrated'").get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const user of db.prepare("SELECT id FROM users WHERE role='reseller'").all())
        replace(
          user.id,
          config.panels.map((p) => p.id),
        );
      db.prepare("INSERT INTO metadata(key,value) VALUES('panel_access_migrated','1')").run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return { allowed, ids, validate, replace };
}
