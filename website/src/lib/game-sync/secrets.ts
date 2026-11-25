import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";

// Crockford's alphabet: no I, L, O or U, so a code survives being read off a screen.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;
const TOKEN = /^ecl_[A-Za-z0-9_-]{43}$/;

/** Only this is stored, for both secrets. Both are random, so a fast hash is right. */
export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** Eight characters for a person to carry over: 40 bits that live for ten minutes. */
export function newLinkCode(): string {
  const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What a player typed, in the form the code was issued in, or null if it cannot be one. */
export function normalizeLinkCode(typed: string): string | null {
  const bare = typed
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (bare.length !== CODE_LENGTH || [...bare].some((c) => !CODE_ALPHABET.includes(c))) return null;
  return `${bare.slice(0, 4)}-${bare.slice(4)}`;
}

export const newDeviceToken = () => `ecl_${randomBytes(32).toString("base64url")}`;

/** The token in an Authorization header, or null. */
export function bearerToken(header: string | null): string | null {
  const token = header?.match(/^Bearer (\S+)$/)?.[1];
  return token && TOKEN.test(token) ? token : null;
}
