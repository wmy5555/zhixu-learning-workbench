import test from 'node:test';
import assert from 'node:assert/strict';
import { mobileBoundaryErrors } from '../scripts/mobile-boundary.mjs';

test('web repository rejects native projects and app toolchains but permits responsive UI and history', () => {
  assert.deepEqual(mobileBoundaryErrors(['public/web/mobile.css', 'docs/ANDROID_SHARED_UI.md', 'tests/mobile-layout.test.mjs'], {dependencies:{'some-library':'1'}}), []);
  for (const path of ['apps/android/app/build.gradle', 'apps/ios/package.json', 'apps/mobile/package.json', 'ios/Podfile', 'android/app/build.gradle', 'capacitor.config.ts'])
    assert.match(mobileBoundaryErrors([path], {})[0], /原生工程已迁出/);
  for (const name of ['@capacitor/core', 'expo', 'expo-router', 'react-native', '@react-native/async-storage'])
    assert.match(mobileBoundaryErrors([], {devDependencies:{[name]:'1'}})[0], /移动端/);
});
