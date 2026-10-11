const catalogMarkupPattern = /<(?:\/?[A-Za-z][^>]*|[!?][^>]*)>/;

const htmlEntities: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeHtmlEntity(entity: string): string {
  const value = entity.slice(1, -1);
  const radix = value.startsWith("#x") || value.startsWith("#X") ? 16 : 10;
  const numeric = radix === 16 ? value.slice(2) : value.startsWith("#") ? value.slice(1) : null;
  if (numeric !== null) {
    const codePoint = Number.parseInt(numeric, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  }
  return htmlEntities[value] ?? entity;
}

function removeControlCharactersExceptNewline(text: string): string {
  let cleaned = "";
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f
    ) {
      continue;
    }
    cleaned += character;
  }
  return cleaned;
}

export function isPlainCatalogDescription(value: string): boolean {
  return !catalogMarkupPattern.test(value);
}

export function normalizeCatalogDescription(description: string | null): string | null {
  if (description === null || description.length === 0) return null;
  const decoded = description
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\"/g, "\"")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g, decodeHtmlEntity)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "");
  const normalized = removeControlCharactersExceptNewline(decoded)
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length === 0 ? null : normalized;
}
