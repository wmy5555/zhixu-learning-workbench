export const fileURLToPath = value => decodeURIComponent(new URL(value).pathname);
export default { fileURLToPath };
