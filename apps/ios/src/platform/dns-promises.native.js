import runtime from './runtime.native.js';
export const lookup = hostname => runtime.resolve(hostname);
export default { lookup };
