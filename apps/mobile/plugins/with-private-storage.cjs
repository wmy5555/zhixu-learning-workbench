const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// Android 12+ device transfer may ignore allowBackup on some vendors. Exclude
// every app domain as well, and keep the actual library under noBackupFilesDir.
const domains = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];
const exclude = domains.map(domain => `    <exclude domain="${domain}" path="." />`).join('\n');
module.exports = function withPrivateStorage(config) {
  config = withAndroidManifest(config, value => {
    const app = value.modResults.manifest.application[0].$;
    app['android:allowBackup'] = 'false';
    app['android:fullBackupContent'] = '@xml/zhixu_backup_rules';
    app['android:dataExtractionRules'] = '@xml/zhixu_data_extraction_rules';
    app['android:usesCleartextTraffic'] = 'false';
    return value;
  });
  return withDangerousMod(config, ['android', async value => {
    const dir = path.join(value.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'zhixu_backup_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${exclude}\n</full-backup-content>\n`);
    fs.writeFileSync(path.join(dir, 'zhixu_data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${exclude}\n  </cloud-backup>\n  <device-transfer>\n${exclude}\n  </device-transfer>\n</data-extraction-rules>\n`);
    return value;
  }]);
};
