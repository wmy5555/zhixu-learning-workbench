// Preserve the Node SQLite contract consumed by the frozen search/store core.
export function sqliteStatement(db, sql) {
  return {
    run(...args) {
      const result = db.runSync(sql, args);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowId };
    },
    get: (...args) => db.getFirstSync(sql, args) ?? undefined,
    all: (...args) => db.getAllSync(sql, args),
    // Expo's iterator finalizes its statement in finally, including early exit.
    iterate: (...args) => db.getEachSync(sql, args),
  };
}
