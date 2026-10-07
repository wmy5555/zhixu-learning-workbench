import { spawnSync } from 'node:child_process';

function parseArgs(args) {
  let serial;
  let adb = 'adb';

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option !== '--serial' && option !== '--adb') {
      throw new Error(`未知参数：${option}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`${option} 缺少参数值`);
    }
    index += 1;

    if (option === '--serial') {
      if (serial !== undefined) throw new Error('--serial 只能指定一次');
      serial = value;
    } else {
      adb = value;
    }
  }

  if (!serial) throw new Error('必须明确指定设备序列号：--serial <serial>');
  return { serial, adb };
}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error.message}\n用法：pnpm android:test-device --serial <serial> [--adb <可执行文件路径>]\n`);
  process.exit(2);
}

const result = spawnSync(options.adb, [
  '-s', options.serial,
  'shell', 'am', 'instrument', '-w',
  'io.github.wmy5555.zhixu.sharedtest.test/android.test.InstrumentationTestRunner',
], {
  encoding: 'utf8',
  timeout: 120_000,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.error) {
  process.stderr.write(`设备测试命令未能完成：${result.error.message}\n`);
  process.exit(1);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const summary = output.match(/\bOK\s*\(\s*(\d+)\s+tests?\s*\)/i);
const instrumentationFailure = /FAILURES!!!|INSTRUMENTATION_(?:FAILED|ABORTED)|instrumentation failed|process crashed/i.test(output);

if (result.status !== 0 || result.signal || instrumentationFailure || !summary || Number(summary[1]) === 0) {
  if (!summary) process.stderr.write('设备测试未输出 OK (N tests) 成功总结。\n');
  else if (Number(summary[1]) === 0) process.stderr.write('设备测试报告的测试数为 0。\n');
  process.exit(typeof result.status === 'number' && result.status !== 0 ? result.status : 1);
}
