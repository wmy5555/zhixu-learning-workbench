import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

mkdirSync('.tmp', { recursive: true });
const directory = mkdtempSync(path.resolve('.tmp', 'mobile-java-'));
try {
  for (const [command, args] of [
    ['javac', ['-encoding', 'UTF-8', '-d', directory, 'android/app/src/main/java/io/github/wmy5555/zhixu/test/SyncRules.java', 'android/tests/SyncRulesTest.java']],
    ['java', ['-cp', directory, 'io.github.wmy5555.zhixu.test.SyncRulesTest']],
  ]) {
    const result = spawnSync(command, args, { encoding: 'utf8', stdio: 'inherit' });
    if (result.error) throw new Error(`${command} 不可用；此检查需要 JDK 17 或以上。`);
    if (result.status !== 0) throw new Error(`${command} 检查失败。`);
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
