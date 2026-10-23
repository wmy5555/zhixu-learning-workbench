import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const files = fs
  .readdirSync(path.join(root, "src"), { recursive: true })
  .filter((f) => /\.(mjs|js)$/.test(f))
  .map((f) => path.join(root, "src", f));
for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
}
const packageInfo = JSON.parse(fs.readFileSync("package.json"));
if (packageInfo.version !== "0.1.0" || packageInfo.main !== "./index.js")
  throw Error("Unexpected app identity");
const nativeConfig = JSON.parse(
  fs.readFileSync("modules/zhixu-runtime/expo-module.config.json"),
);
if (!nativeConfig.apple.modules.includes("ZhixuRuntimeModule"))
  throw Error("Native runtime is not registered");
if (!nativeConfig.android.modules.includes("expo.modules.zhixuruntime.ZhixuRuntimeModule"))
  throw Error("Android runtime is not registered");
const config = JSON.parse(fs.readFileSync("app.json")).expo;
if (
  !config.ios.supportsTablet ||
  config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads !== false
)
  throw Error("Unexpected platform/network setting");
if (config.android.allowBackup !== false || config.android.package !== "com.zhixu.learning.nativeapp")
  throw Error("Android storage/identity configuration is invalid");
const metro = fs.readFileSync("metro.config.cjs", "utf8");
if (!metro.includes('["ios", "android"].includes(platform)'))
  throw Error("Both platforms must resolve native adapters");
for (const file of fs
  .readdirSync("src/screens")
  .filter((f) => f.endsWith(".tsx"))) {
  const content = fs.readFileSync("src/screens/" + file, "utf8");
  if (/from\s+['"]react-native-webview|['"]use dom['"]/.test(content))
    throw Error("Web container in native screen " + file);
}
console.log(
  `Native source checks passed: ${files.length} JS modules; iOS/Android adapters, registered native modules, backup exclusion, no WebView screens.`,
);
