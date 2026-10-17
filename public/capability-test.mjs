// Keep edits made while a paid test is running; never save a newer, untested draft.
export async function testAndSaveCapability({ capability, snapshot, test, save, unchanged, saving }) {
  const result = await test(capability, snapshot);
  if (!unchanged()) return { saved: false, changed: true };
  saving(true);
  try {
    const saved = await save(capability, snapshot, result.receipt);
    if (saved?.saved !== true) throw new Error('Save was not confirmed.');
    return { saved: true, ...(saved?.warning ? { warning: saved.warning } : {}) };
  } catch (error) {
    // Do not expose provider text or the submitted key through this status message.
    throw Object.assign(new Error('连接测试成功，但未能确认保存；输入已保留，请先检查已保存配置，避免重复测试产生费用。'), { cause: error, code: 'SAVE_UNCONFIRMED' });
  } finally { saving(false); }
}
