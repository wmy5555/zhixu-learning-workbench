const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
config.maxWorkers = 2;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Explicit .js imports in the frozen ESM core do not receive Metro's usual
  // platform extension search. Select the native adapter here, fail closed.
  if (platform === "ios" && moduleName.startsWith(".")) {
    const target = path.resolve(
      path.dirname(context.originModulePath),
      moduleName,
    );
    const root = path.join(__dirname, "src", "platform") + path.sep;
    if (
      target.startsWith(root) &&
      target.endsWith(".js") &&
      !target.endsWith(".native.js")
    ) {
      const native = target.slice(0, -3) + ".native.js";
      if (fs.existsSync(native))
        return { type: "sourceFile", filePath: native };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
