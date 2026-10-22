import { createHash, randomUUID } from 'node:crypto';
import { validateSettings } from './settings-validation.mjs';
import { fail } from './store.mjs';

const fields = {
  model: ['enabled', 'baseUrl', 'model', 'apiKey', 'timeoutMs'],
  embedding: ['enabled', 'baseUrl', 'model', 'apiKey'],
  search: ['enabled', 'baseUrl', 'apiKey'], fetch: ['enabled'],
};
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Receipts are short-lived, single-use proof of this exact tested draft, not credentials.
export function createCapabilityTests({ settings, defaults, revision, ai, save, now = Date.now }) {
  const receipts = new Map();
  function payload(capability, config) {
    if (!Object.hasOwn(fields, capability)) fail('请选择可测试的能力。');
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !fields[capability].includes(key))) fail('连接测试只接受对应能力的连接设置。');
    const group = capability === 'model' ? 'ai' : capability;
    const input = { [group]: Object.fromEntries(fields[capability].filter(key => Object.hasOwn(config, key)).map(key => [key, config[key]])) };
    const { next, credentials } = validateSettings(input, settings(), defaults);
    return { input, next, secret: credentials[0]?.value };
  }
  function prune() { for (const [id, item] of receipts) if (item.expires <= now()) receipts.delete(id); }
  return {
    async test(capability, config) {
      prune();
      const before = revision(), draft = payload(capability, config);
      const result = await ai.test(capability, { settings: draft.next, secret: draft.secret });
      if (result?.ok !== true) fail('连接测试未确认成功，未保存配置。', 'INVALID_RESPONSE', 502);
      if (before !== revision()) fail('测试期间已保存的设置发生变化，请重新测试。', 'CONFIG_CHANGED', 409);
      while (receipts.size >= 16) receipts.delete(receipts.keys().next().value);
      const receipt = randomUUID();
      receipts.set(receipt, { capability, digest: digest(draft.input), revision: before, expires: now() + 300000 });
      return { ok: true, capability, receipt };
    },
    save(capability, config, receipt) {
      prune();
      const proof = receipts.get(receipt);
      if (!proof || proof.capability !== capability) fail('连接测试回执已失效，请重新测试。', 'CONFIG_CHANGED', 409);
      receipts.delete(receipt);
      const draft = payload(capability, config);
      if (proof.revision !== revision() || proof.digest !== digest(draft.input)) fail('测试后配置发生变化，未覆盖已保存设置，请重新测试。', 'CONFIG_CHANGED', 409);
      save(draft.input);
      return { ok: true, saved: true, capability };
    },
  };
}
