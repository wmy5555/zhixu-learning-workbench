import { createHash } from 'node:crypto';

export const now = () => new Date().toISOString();
export const hash = value => createHash('sha256').update(value).digest('hex');
export function fail(message, code = 'INVALID', status = 400) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
