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
const config = JSON.parse(fs.readFileSync("app.json")).expo;
if (
  !config.ios.supportsTablet ||
  config.ios.infoPlist.NSAppTransportSecurity.NSAllowsArbitraryLoads !== false
)
  throw Error("Unexpected platform/network setting");
for (const file of fs
  .readdirSync("src/screens")
  .filter((f) => f.endsWith(".tsx"))) {
  const content = fs.readFileSync("src/screens/" + file, "utf8");
  if (/from\s+['"]react-native-webview|['"]use dom['"]/.test(content))
    throw Error("Web container in native screen " + file);
}
console.log(
  `Native source checks passed: ${files.length} JS modules; iOS-only app, registered local module, tablet support, no WebView screens.`,
);
