try {
  const response = await fetch('http://127.0.0.1:4318/', { signal: AbortSignal.timeout(1500) });
  process.exit(response.ok && (await response.text()).includes('app.mjs') ? 0 : 1);
} catch { process.exit(1); }
