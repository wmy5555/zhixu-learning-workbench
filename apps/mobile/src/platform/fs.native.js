import runtime from './runtime.native.js';
import { Buffer } from 'buffer';
function call(op, args) {
  const result = JSON.parse(runtime.files(op, JSON.stringify(args)));
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
}
const path = value => value instanceof URL ? decodeURIComponent(value.pathname) : String(value);
export const existsSync = file => call('exists', { path: path(file) });
export const mkdirSync = (file, options = {}) => call('mkdir', { path: path(file), recursive: options.recursive === true });
export const readFileSync = (file, options) => {
  const bytes = Buffer.from(call('read', { path: path(file) }), 'base64');
  const encoding = typeof options === 'string' ? options : options?.encoding;
  return encoding ? bytes.toString(encoding) : bytes;
};
export const writeFileSync = (file, data, options = {}) => call('write', { path: path(file), data: Buffer.from(data).toString('base64'), exclusive: options.flag === 'wx' });
export const renameSync = (from, to) => call('rename', { path: path(from), to: path(to) });
export const linkSync = (from, to) => call('link', { path: path(from), to: path(to) });
export const unlinkSync = file => call('unlink', { path: path(file) });
export const rmSync = (file, options = {}) => call('remove', { path: path(file), recursive: options.recursive === true, force: options.force === true });
export const realpathSync = file => call('realpath', { path: path(file) });
function stat(file, follow) {
  const s = call('stat', { path: path(file), follow });
  return { ...s, isFile: () => s.kind === 'file', isDirectory: () => s.kind === 'directory', isSymbolicLink: () => s.kind === 'symlink' };
}
export const statSync = file => stat(file, true);
export const lstatSync = file => stat(file, false);
export const readdirSync = (file, options = {}) => call('list', { path: path(file) }).map(name => options.withFileTypes ? { name, ...lstatSync(path(file) + '/' + name) } : name);
export const opendirSync = file => { const rows = readdirSync(file, { withFileTypes: true }); let index = 0; return { readSync: () => rows[index++] ?? null, closeSync() {} }; };
// The handle is a validated path. Durable flush opens and fsyncs the actual file natively.
export const openSync = (file, flags) => { if (flags !== 'r+') throw Error('Unsupported open mode'); statSync(file); return path(file); };
export const fsyncSync = file => call('sync', { path: path(file) });
export const closeSync = () => {};
export default { existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,linkSync,unlinkSync,rmSync,realpathSync,statSync,lstatSync,readdirSync,opendirSync,openSync,fsyncSync,closeSync };
