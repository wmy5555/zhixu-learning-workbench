import {readFileSync,lstatSync} from './fs.native.js';
export const readFile = async (...args) => readFileSync(...args);
export const lstat = async (...args) => lstatSync(...args);
export default { readFile,lstat };
