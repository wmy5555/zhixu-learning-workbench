import runtime from './runtime.native.js';
export const tmpdir = () => runtime.root + '/temporary';
export default { tmpdir };
