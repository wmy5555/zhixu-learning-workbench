// A completed connection test and a confirmed settings write are separate receipts.
export async function saveTestedCapability(save) {
  try {
    const result = await save();
    if (result?.saved !== true) throw new Error('Save was not confirmed.');
    return { saved: true, ...(result.warning ? { warning: result.warning } : {}) };
  } catch (cause) {
    throw Object.assign(new Error('连接测试成功，但未能确认保存；输入已保留，请先检查已保存配置，避免重复测试产生费用。'), { cause, code: 'SAVE_UNCONFIRMED' });
  }
}

// Keep edits made while a paid test is running; never save a newer, untested draft.
export async function testAndSaveCapability({ capability, snapshot, test, save, unchanged, saving }) {
  const result = await test(capability, snapshot);
  if (!unchanged()) return { saved: false, changed: true };
  saving(true);
  try { return await saveTestedCapability(() => save(capability, snapshot, result.receipt)); }
  finally { saving(false); }
}
