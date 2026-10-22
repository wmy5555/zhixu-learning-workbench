import * as SQLite from 'expo-sqlite';
import {basename,dirname} from './path.native.js';
export class DatabaseSync {
  constructor(file, { readOnly = false } = {}) {
    this.db = file === ':memory:' ? SQLite.openDatabaseSync(':memory:', {useNewConnection:true}) : SQLite.openDatabaseSync(basename(file), {useNewConnection:true}, dirname(file));
    if (readOnly) this.db.execSync('PRAGMA query_only=ON');
  }
  exec(sql) { this.db.execSync(sql); }
  prepare(sql) {
    // Expo helpers finalize each statement; no native statement handles leak between renders.
    return { run: (...args) => this.db.runSync(sql, args), get: (...args) => this.db.getFirstSync(sql, args) ?? undefined, all: (...args) => this.db.getAllSync(sql, args) };
  }
  close() { this.db.closeSync(); }
}
export default { DatabaseSync };
