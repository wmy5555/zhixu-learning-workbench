const FORMAT = "zhixu-source-exchange";
const SOURCE_FIELDS = ["platform", "author", "url", "date", "locator", "topic"];
const MAX_FILE_BYTES = 160 * 1024;
const MAX_BODY_BYTES = 128 * 1024;

function invalid(message = "文件不是有效的 UTF-8 原文交换文件。") {
  const error = new Error(message);
  error.code = "SOURCE_FILE_INVALID";
  return error;
}

function utf8Length(value) {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw invalid("文件包含无效 Unicode 字符。");
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw invalid("文件包含无效 Unicode 字符。");
  }
  return new TextEncoder().encode(value).length;
}

function rejectDuplicateJsonKeys(source) {
  let index = 0;
  const whitespace = () => { while (/\s/.test(source[index] || "")) index++; };
  const stringEnd = start => {
    index = start + 1;
    while (index < source.length) {
      if (source[index] === "\\") index += 2;
      else if (source[index++] === '"') return index;
    }
    throw invalid();
  };
  const value = () => {
    whitespace();
    if (source[index] === '"') { index = stringEnd(index); return; }
    if (source[index] === "{") {
      index++; whitespace();
      const keys = new Set();
      if (source[index] === "}") { index++; return; }
      while (index < source.length) {
        whitespace();
        if (source[index] !== '"') throw invalid();
        const start = index, end = stringEnd(index), key = JSON.parse(source.slice(start, end));
        if (keys.has(key)) throw invalid("交换文件包含重复字段。");
        keys.add(key); index = end; whitespace();
        if (source[index++] !== ":") throw invalid();
        value(); whitespace();
        const delimiter = source[index++];
        if (delimiter === "}") return;
        if (delimiter !== ",") throw invalid();
      }
      throw invalid();
    }
    if (source[index] === "[") {
      index++; whitespace();
      if (source[index] === "]") { index++; return; }
      while (index < source.length) {
        value(); whitespace();
        const delimiter = source[index++];
        if (delimiter === "]") return;
        if (delimiter !== ",") throw invalid();
      }
      throw invalid();
    }
    while (index < source.length && !/[\s,}\]]/.test(source[index])) index++;
    if (index === 0) throw invalid();
  };
  value(); whitespace();
  if (index !== source.length) throw invalid();
}

function validateExchangeUrl(value) {
  if (!value) return;
  if (/[\p{Cc}]/u.test(value)) throw invalid("来源网址无效。");
  let url;
  try { url = new URL(value); } catch { throw invalid("来源网址无效。"); }
  if (!new Set(["http:", "https:"]).has(url.protocol) || !url.hostname) throw invalid("来源网址只允许含有效主机的 HTTP 或 HTTPS。");

  const authority = value.match(/^https?:\/\/([^/?#]*)/i)?.[1];
  if (!authority) throw invalid("来源网址无效。");
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  let rawHost;
  if (hostPort.startsWith("[")) {
    const end = hostPort.indexOf("]");
    if (end < 0) throw invalid("来源网址无效。");
    rawHost = hostPort.slice(0, end + 1);
  } else {
    if ((hostPort.match(/:/g) || []).length > 1) throw invalid("来源网址无效。");
    rawHost = hostPort.split(":", 1)[0];
  }
  if (!rawHost || /\s/u.test(rawHost) || rawHost.includes("\\") || rawHost.includes("%")) throw invalid("来源网址无效。");
  const asciiHost = url.hostname.toLowerCase();
  if (asciiHost.startsWith("[") && asciiHost.endsWith("]")) return;

  const numericHost = rawHost.endsWith(".") ? rawHost.slice(0, -1) : rawHost;
  const labels = numericHost.split(".");
  const canonicalIpv4 = labels.length === 4 && labels.every(label => /^(?:0|[1-9][0-9]{0,2})$/.test(label) && Number(label) <= 255);
  const lastLabel = labels.at(-1) || "";
  const numericEnding = /^[0-9]+$/.test(lastLabel) || /^0x[0-9a-f]*$/i.test(lastLabel);
  if (numericEnding && !canonicalIpv4) throw invalid("来源网址包含无法兼容的数字主机。");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(asciiHost) && !canonicalIpv4) throw invalid("来源网址包含无法兼容的数字主机。");
  if (/^\d+(?:\.\d+){0,3}\.?$/.test(rawHost) && !canonicalIpv4) throw invalid("来源网址包含无法兼容的数字主机。");

  const dnsHost = asciiHost.endsWith(".") ? asciiHost.slice(0, -1) : asciiHost;
  if (dnsHost.length > 253 || dnsHost.split(".").some(label => label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) throw invalid("来源网址主机名无效。");
}

function exchangeItem(name, text, header, body) {
  if (/"format"\s*:\s*"zhixu-source-exchange"/.test(header)) {
    let data;
    try {
      rejectDuplicateJsonKeys(header);
      data = JSON.parse(header);
    } catch (error) {
      if (error?.code === "SOURCE_FILE_INVALID") throw error;
      throw invalid();
    }
    if (!data || Array.isArray(data) || typeof data !== "object"
      || Object.keys(data).sort().join(",") !== "format,source,title,version"
      || data.format !== FORMAT || data.version !== 1 || typeof data.title !== "string"
      || !data.source || Array.isArray(data.source) || typeof data.source !== "object"
      || Object.keys(data.source).some(key => !SOURCE_FIELDS.includes(key))) throw invalid();
    const title = data.title.trim();
    if (!title || [...title].length > 200 || /[\p{Cc}]/u.test(title)) throw invalid("交换文件标题无效。");
    for (const field of SOURCE_FIELDS) {
      if (!Object.hasOwn(data.source, field)) data.source[field] = "";
      const value = data.source[field];
      if (typeof value !== "string" || value.includes("\0") || [...value].length > (field === "url" || field === "locator" ? 2048 : 200)) {
        throw invalid("交换文件来源信息无效。");
      }
    }
    validateExchangeUrl(data.source.url);
    if (!body.trim() || body.includes(String.fromCharCode(0)) || utf8Length(body) > MAX_BODY_BYTES) throw invalid("交换文件正文为空、含无效字符或超过 128 KiB。");
    return { title, body, ...data.source, privacy: "local" };
  }

  const title = String(name || "").replace(/\.(?:md|txt)$/i, "").trim();
  if (!title || [...title].length > 200 || /[\p{Cc}]/u.test(title)) throw invalid("文件名标题无效。");
  if (!text.trim() || text.includes(String.fromCharCode(0)) || utf8Length(text) > MAX_BODY_BYTES) throw invalid("文件正文为空、含无效字符或超过 128 KiB。");
  return { title, body: text, platform: "本地文件", author: "", url: "", date: "", locator: name, topic: "", privacy: "local" };
}

export function parseSourceFile({ name, text } = {}) {
  if (typeof name !== "string" || !/\.(?:md|txt)$/i.test(name) || typeof text !== "string") throw invalid();
  if (utf8Length(text) > MAX_FILE_BYTES) throw invalid("文件超过 160 KiB。");
  const normalized = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const opening = normalized.match(/^---\r?\n/);
  if (!opening) return exchangeItem(name, normalized, "", normalized);
  const afterOpening = opening[0].length;
  const separator = /\r?\n---(?:\r?\n|$)/g;
  separator.lastIndex = afterOpening;
  const match = separator.exec(normalized);
  if (!match) return exchangeItem(name, normalized, "", normalized);
  const header = normalized.slice(afterOpening, match.index);
  const signature = /"format"\s*:\s*"zhixu-source-exchange"/.test(header);
  if (signature) return exchangeItem(name, normalized, header, normalized.slice(match.index + match[0].length));
  return exchangeItem(name, normalized, "", normalized);
}
