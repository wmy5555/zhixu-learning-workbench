import * as SQLite from 'expo-sqlite';
import {basename,dirname} from './path.native.js';
import { sqliteStatement } from './sqlite-contract.mjs';
export class DatabaseSync {
  constructor(file, { readOnly = false } = {}) {
    this.db = file === ':memory:' ? SQLite.openDatabaseSync(':memory:', {useNewConnection:true}) : SQLite.openDatabaseSync(basename(file), {useNewConnection:true}, dirname(file));
    if (readOnly) this.db.execSync('PRAGMA query_only=ON');
  }
  exec(sql) { this.db.execSync(sql); }
  prepare(sql) {
    // Expo helpers finalize each statement; no native statement handles leak between renders.
    return sqliteStatement(this.db, sql);
  }
  close() { this.db.closeSync(); }
}
export default { DatabaseSync };
