const expo = require('eslint-config-expo/flat');
module.exports = [
  ...expo,
  { ignores: ['dist/**', 'node_modules/**', '.tmp/**', 'src/core/**', 'src/reference/**'] },
];
