import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import * as classification from '../../public/note-classification.mjs';

// The legacy UI must create DOM nodes in the fixture's realm. Its classification
// data, also imported by the app and tutorial, comes from the real ES module.
const url = new URL('../../public/ui.mjs', import.meta.url);
const script = new Script(readFileSync(url, 'utf8')
  .replace(/^import \{[^}]+\} from ['"]\.\/note-classification\.mjs['"];\r?$/m, '')
  .replace(/^export /gm, ''), { filename: url.pathname });

export function loadLegacyUi(context) {
  Object.assign(context, classification);
  script.runInContext(context);
}
