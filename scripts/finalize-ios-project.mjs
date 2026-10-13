import { readFile, writeFile } from 'node:fs/promises';
const file = new URL('../apps/ios/ios/App/CapApp-SPM/Package.swift', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (pkg.dependencies['@capacitor/ios'] !== pkg.dependencies['@capacitor/core']) throw new Error('Capacitor iOS/core versions must match');
const source = await readFile(file, 'utf8');
const pattern = /\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", (?:from|exact): "[0-9.]+"\)/g;
if ([...source.matchAll(pattern)].length !== 1) throw new Error('Unexpected Capacitor Swift package manifest');
await writeFile(file, source.replace(pattern, `.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "${pkg.dependencies['@capacitor/ios']}")`));
