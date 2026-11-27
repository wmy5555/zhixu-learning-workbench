// The web repository no longer owns native app projects or their runtime toolchains.
export function mobileBoundaryErrors(files, pkg) {
  const errors = [];
  for (const file of files) {
    if (/^(?:(?:apps\/)?(?:android|ios)\/|apps\/mobile\/|capacitor\.config\.(?:json|js|mjs|ts)$)/i.test(file))
      errors.push(`${file}: 原生工程已迁出，请在对应移动端仓库维护。`);
  }
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(pkg[group] || {})) {
      if (name.startsWith('@capacitor/') || name === 'expo' || name === 'react-native' || name.startsWith('expo-') || name.startsWith('@react-native/'))
        errors.push(`${name}: 移动端运行或构建依赖应在对应移动端仓库维护。`);
    }
  }
  return errors;
}
