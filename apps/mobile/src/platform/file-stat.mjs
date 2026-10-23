export function fileStat(raw, { bigint = false } = {}) {
  const mtimeNs = raw.mtimeNs !== undefined ? BigInt(raw.mtimeNs) : BigInt(Math.trunc(raw.mtimeMs * 1e6));
  const ctimeNs = raw.ctimeNs !== undefined ? BigInt(raw.ctimeNs) : mtimeNs;
  const result = {
    ...raw,
    mtime: new Date(Number(mtimeNs / 1000000n)),
    ctime: new Date(Number(ctimeNs / 1000000n)),
    mtimeMs: Number(mtimeNs) / 1e6,
    ctimeMs: Number(ctimeNs) / 1e6,
    mtimeNs,
    ctimeNs,
    isFile: () => raw.kind === 'file',
    isDirectory: () => raw.kind === 'directory',
    isSymbolicLink: () => raw.kind === 'symlink',
  };
  for (const key of ['size', 'nlink', 'dev', 'ino']) {
    const value = raw[key] ?? 0;
    result[key] = bigint ? BigInt(value) : Number(value);
  }
  return result;
}
