// This is an outgoing text view, never a rewrite of Markdown or its local index.
// The reserved content-addressed image directory is not part of an AI input.
const target = String.raw`\.\.\/\.zhixu-attachments\/[a-f0-9]{64}\.(?:png|jpe?g|gif|webp)(?:[?#][^\s)>"']*)?`;
const destination = String.raw`(?:<${target}>|${target})`;
const title = String.raw`(?:[ \t]+(?:"[^"\r\n]*"|'[^'\r\n]*'|\([^()\r\n]*\)))?`;
const inline = new RegExp(String.raw`!?\[(?:\\[\s\S]|[^\[\]\\])*\]\([ \t]*${destination}${title}[ \t]*\)`, 'gi');
const definition = new RegExp(String.raw`^[ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*${destination}${title}[ \t]*(?=\r?$)`, 'gim');
const htmlImage = new RegExp(String.raw`<img\b(?=[^>]*\bsrc\s*=\s*["']?${target})[^>]*>`, 'gi');
const label = value => value.replace(/\\(.)/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase();

export function outboundText(value, { preserveOffsets = false } = {}) {
  if (typeof value !== 'string') return value;
  const replacement = match => preserveOffsets ? match.replace(/[^\r\n]/g, ' ') : '';
  const definitions = new Set();
  let text = value.replace(definition, (match, id) => { definitions.add(label(id)); return replacement(match); });
  if (definitions.size) text = text.replace(/!\[((?:\\[\s\S]|[^\[\]\\])*)\](?:\[([^\]\r\n]*)\])?/g, (match, alt, id) =>
    definitions.has(label(id || alt)) ? replacement(match) : match);
  return text.replace(inline, replacement).replace(htmlImage, replacement);
}

export function outboundTitle(note, { preserveOffsets = false } = {}) {
  // Old temporary titles may already be a truncated image prefix. Derive their
  // outgoing view from the complete body, without changing the saved title.
  const title = note.meta?.titleOrigin === 'temporary' && note.title === note.meta.titlePlaceholder
    ? outboundText(note.body).replace(/\s+/gu, ' ').trim().slice(0, 36)
    : outboundText(note.title);
  return preserveOffsets ? title.padEnd(note.title.length, ' ').slice(0, note.title.length) : title;
}
