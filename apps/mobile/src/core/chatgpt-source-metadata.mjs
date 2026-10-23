// Frozen desktop business rules; platform import adaptation only unless documented.
// Source dates describe the received material, never the import/handoff clock.
export function validSourceDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}

export function historySourceMetadata(snapshot) {
  const first = snapshot.units[0];
  const raw = first?.created_at;
  // The reader provides a formatted calendar timestamp. Preserve its calendar
  // date; do not reinterpret a timezone-less value in this machine's timezone.
  const match = typeof raw === 'string' && /^(\d{4}-\d{2}-\d{2})(?:[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.exec(raw);
  const date = match && validSourceDate(match[1]) ? match[1] : '';
  return {
    conversationUrl: `https://chatgpt.com/c/${snapshot.conversation_id}`,
    conversationDate: date,
    conversationDateBasis: date
      ? `当前可见分支首条消息日期；来源 units[0].created_at（${raw}），消息 ${first.message_id}；不是平台会话创建日期。`
      : '当前可见分支首条消息日期缺失或格式无法核对；未用导入时间、签发时间或最后更新时间代替。',
  };
}

export function conversationOrigin(value, acquiredAt) {
  return { platform: 'ChatGPT', author: '', url: value.conversationUrl, date: value.conversationDate || '',
    dateBasis: value.conversationDateBasis || (value.conversationDate ? '调用方提供的原资料日期，知序未独立核对。' : '原资料日期未提供；未用导入时间代替。'),
    locator: value.title, acquiredAt };
}
