import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, { mode: 0o600 });
    const delays = [20, 50, 100];
    for (let attempt = 0; ; attempt++) {
      try { fs.renameSync(tmp, file); break; }
      catch (error) {
        // Windows scanners and synced folders may briefly hold the destination open.
        // Retry the same atomic replacement; never remove the previous good file.
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= delays.length) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
      }
    }
  }
  finally { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); }
}
