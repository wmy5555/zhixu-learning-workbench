import posix from 'path-browserify';
import runtime from './runtime.native.js';
export const resolve = (...parts) => posix.resolve(runtime.root, ...parts);
export const { join, dirname, basename, extname, relative, normalize, isAbsolute, sep, parse, format } = posix;
export default { ...posix, resolve, posix, win32: { isAbsolute: value => /^[A-Za-z]:[\\/]|^[\\/]/.test(value) } };
