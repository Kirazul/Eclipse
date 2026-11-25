// The DLL's own Base64Encode / Base64Decode (core/Storage.cpp), not the
// platform's: atob throws on the whitespace a chat window adds, and the DLL's
// rules are what decide whether a code is a code.
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const REVERSE = new Map([...ALPHABET].map((c, i) => [c, i]));

const utf8 = new TextEncoder();
const text = new TextDecoder();

export function base64Encode(input: string): string {
  const bytes = utf8.encode(input);
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(v >> 18) & 63] +
      ALPHABET[(v >> 12) & 63] +
      ALPHABET[(v >> 6) & 63] +
      ALPHABET[v & 63];
  }
  if (i < bytes.length) {
    const two = i + 1 < bytes.length;
    const v = (bytes[i] << 16) | (two ? bytes[i + 1] << 8 : 0);
    out += ALPHABET[(v >> 18) & 63] + ALPHABET[(v >> 12) & 63];
    out += two ? ALPHABET[(v >> 6) & 63] : "=";
    out += "=";
  }
  return out;
}

/** Null on a stray byte. Whitespace is skipped and padding ends the data. */
export function base64Decode(input: string): string | null {
  const bytes: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const c of input) {
    if (/\s/.test(c)) continue;
    if (c === "=") break;
    const v = REVERSE.get(c);
    if (v === undefined) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return text.decode(new Uint8Array(bytes));
}
