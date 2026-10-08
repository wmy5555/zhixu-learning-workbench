const FORMAT = "zhixu-source-exchange";
const SOURCE_FIELDS = ["platform", "author", "url", "date", "locator", "topic"];
const MAX_DESKTOP_BODY_CHARS = 500000;
const MAX_EXCHANGE_HEADER_BYTES = 32 * 1024;

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

// Inspect JSON tokens only at the root object. A nested object or YAML string is ordinary Markdown.
// This intentionally recognizes a declaration even when the rest of its JSON is malformed.
function declaresExchange(source) {
  let index = 0, depth = 0, expectKey = false;
  const whitespace = () => { while (/\s/.test(source[index] || "")) index++; };
  whitespace();
  if (source[index] !== "{") return false;
  while (index < source.length) {
    const char = source[index];
    if (char === '"') {
      const start = index++;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === '"') break;
      }
      if (depth === 1 && expectKey) {
        let key;
        try { key = JSON.parse(source.slice(start, index)); } catch { return false; }
        whitespace();
        if (source[index] === ":") {
          index++; whitespace();
          if (key === "format" && source[index] === '"') {
            const valueStart = index++;
            while (index < source.length) {
              if (source[index] === "\\") index += 2;
              else if (source[index++] === '"') break;
            }
            try { if (JSON.parse(source.slice(valueStart, index)) === FORMAT) return true; } catch { return false; }
          }
        }
        expectKey = false;
      }
      continue;
    }
    if (char === "{" || char === "[") { depth++; if (depth === 1) expectKey = true; }
    else if (char === "}" || char === "]") { depth--; if (depth === 0) return false; }
    else if (char === "," && depth === 1) expectKey = true;
    index++;
  }
  return false;
}

// Portable DNS repertoire: ASCII letters/digits/hyphens and basic CJK ideographs.
// Decode A-labels too, so an ASCII xn-- spelling cannot bypass the same repertoire.
function portableDnsLabel(label) {
  let decoded = label;
  if (/^xn--/i.test(label)) {
    const input = label.slice(4).toLowerCase(), output = [];
    let index = input.lastIndexOf("-"), n = 128, i = 0, bias = 72;
    if (index >= 0) for (const char of input.slice(0, index)) output.push(char.codePointAt(0));
    index = index >= 0 ? index + 1 : 0;
    const adapt = (delta, points, first) => {
      delta = first ? Math.floor(delta / 700) : Math.floor(delta / 2);
      delta += Math.floor(delta / points);
      let k = 0;
      while (delta > 455) { delta = Math.floor(delta / 35); k += 36; }
      return k + Math.floor(36 * delta / (delta + 38));
    };
    try {
      while (index < input.length) {
        const old = i;
        let weight = 1;
        for (let k = 36; ; k += 36) {
          const code = input.charCodeAt(index++);
          const digit = code >= 97 && code <= 122 ? code - 97 : code >= 48 && code <= 57 ? code - 22 : -1;
          if (digit < 0 || !Number.isSafeInteger(i + digit * weight)) return false;
          i += digit * weight;
          const threshold = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
          if (digit < threshold) break;
          weight *= 36 - threshold;
          if (!Number.isSafeInteger(weight)) return false;
        }
        const points = output.length + 1;
        bias = adapt(i - old, points, old === 0);
        n += Math.floor(i / points); i %= points;
        if (n > 0x10ffff || n >= 0xd800 && n <= 0xdfff) return false;
        output.splice(i++, 0, n);
      }
      decoded = String.fromCodePoint(...output);
      if (new URL(`http://${decoded}`).hostname !== label.toLowerCase()) return false;
    } catch { return false; }
  }
  return /^[a-z0-9\u4e00-\u9fff](?:[a-z0-9\u4e00-\u9fff-]*[a-z0-9\u4e00-\u9fff])?$/i.test(decoded);
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
  if (labels.some(label => !portableDnsLabel(label))) throw invalid("来源网址主机名不符合可移植字符范围。");
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
  if (header) {
    if (utf8Length(header) > MAX_EXCHANGE_HEADER_BYTES) throw invalid("交换文件头部超过限制。");
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
    if (!title || [...title].length > 200 || /[\p{Cc}]/u.test(data.title)) throw invalid("交换文件标题无效。");
    for (const field of SOURCE_FIELDS) {
      if (!Object.hasOwn(data.source, field)) data.source[field] = "";
      const value = data.source[field];
      if (typeof value !== "string" || /[\r\n\0]/.test(value) || [...value].length > (field === "url" || field === "locator" ? 2048 : 200)) {
        throw invalid("交换文件来源信息无效。");
      }
    }
    validateExchangeUrl(data.source.url);
    if (!body.trim() || body.includes(String.fromCharCode(0)) || body.length > MAX_DESKTOP_BODY_CHARS) throw invalid("交换文件正文为空、含无效字符或超过 500000 个字符。");
    return { title, body, ...data.source, privacy: "local" };
  }

  const title = String(name || "").replace(/\.(?:md|txt)$/i, "").trim();
  if (!title || [...title].length > 200 || /[\p{Cc}]/u.test(title)) throw invalid("文件名标题无效。");
  if (!text.trim() || text.includes(String.fromCharCode(0)) || text.length > MAX_DESKTOP_BODY_CHARS) throw invalid("文件正文为空、含无效字符或超过 500000 个字符。");
  return { title, body: text, platform: "本地文件", author: "", url: "", date: "", locator: name, topic: "", privacy: "local" };
}

export function parseSourceFile({ name, text } = {}) {
  if (typeof name !== "string" || !/\.(?:md|txt)$/i.test(name) || typeof text !== "string") throw invalid();
  utf8Length(text);
  const normalized = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const opening = normalized.match(/^---\r?\n/);
  if (!opening) return exchangeItem(name, normalized, "", normalized);
  const afterOpening = opening[0].length;
  const separator = /\r?\n---(?:\r?\n|$)/g;
  separator.lastIndex = afterOpening;
  const match = separator.exec(normalized);
  if (!match) {
    if (declaresExchange(normalized.slice(afterOpening))) throw invalid();
    return exchangeItem(name, normalized, "", normalized);
  }
  const header = normalized.slice(afterOpening, match.index);
  const signature = declaresExchange(header);
  if (signature) return exchangeItem(name, normalized, header, normalized.slice(match.index + match[0].length));
  return exchangeItem(name, normalized, "", normalized);
}
