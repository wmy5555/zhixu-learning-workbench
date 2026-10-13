import { Capacitor, registerPlugin } from './capacitor-core.mjs';
import { createIOSClient } from './ios-client.mjs';
import { mountIOSPreview } from './ios-ui.mjs';

if (Capacitor.getPlatform() !== 'ios') throw new Error('iOS native runtime is required. Browser tests do not represent an installed iOS app.');
await mountIOSPreview(createIOSClient(registerPlugin('ZhixuIOSLocal')));
