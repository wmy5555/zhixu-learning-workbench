import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const action = process.argv[2];
if (!['add', 'copy', 'sync', 'open'].includes(action)) throw new Error('Expected add, copy, sync or open');
if (['sync', 'open'].includes(action) && process.platform !== 'darwin') throw new Error('iOS native sync/open requires macOS and Xcode; Windows preparation is not an iOS build');
const arguments_ = [fileURLToPath(new URL('../node_modules/@capacitor/cli/bin/capacitor', import.meta.url)), action, 'ios'];
if (action === 'add') arguments_.push('--packagemanager', 'SPM');
const result = spawnSync(process.execPath, arguments_, { cwd: fileURLToPath(new URL('../apps/ios', import.meta.url)), stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status === 0) await import('./finalize-ios-project.mjs');
process.exitCode = result.status ?? 1;
