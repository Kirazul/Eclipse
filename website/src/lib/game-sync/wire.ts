// What the game and the website say to each other. Plain lines, with anything a
// player typed in base64, because the game has a base64 codec and no JSON parser and
// this keeps it that way. The relay's session endpoint talks to the game the same way.
//
//   request   eclipse-sync 1
//             cursor <rev>
//             label <b64>                            optional
//             put <base> <b64 name> <b64 icon|-> <code>
//             del <base> <b64 name>
//
//   answer    ok <cursor> <more 0|1>
//             ack <rev> <b64 name>
//             rej <b64 name>
//             set <rev> <b64 name> <b64 icon|-> <code>
//             del <rev> <b64 name>
//
// A picture from the Showcase studio, for one saved set (POST /api/game/shot):
//
//   request   eclipse-shot 1
//             set <b64 name>
//             image <b64 jpeg or png>
//
//   answer    ok <pictures on the set> | unlinked | missing | set-full | account-full
//             | busy | too-large | unreadable | bad-request | unavailable
//
// Whether a newer overlay is out, asked once a launch (POST /api/game/version, no
// token). The game sends its own build; the site holds the comparison, so a change to
// it needs no new DLL:
//
//   request   eclipse-version 1
//             build <the overlay's BuildText()>
//
//   answer    update <newest release> | current | bad-request
//
// The migration's limits are repeated here so one bad set is refused alone. Left to
// the database's checks, it would fail the batch and every set in it, on every retry.

export const SYNC_HEADER = "eclipse-sync 1";

const MAX_CHANGES = 100;
const MAX_NAME = 80;
const MAX_ICON = 64;
const MAX_CODE = 32768;
const LOOK_CODE = /^ECA1:[A-Za-z0-9+/=]+$/;
const UNSTORABLE = /[\u0000-\u001f\u007f�]/;
const BASE64 = /^[A-Za-z0-9+/=]*$/;

export interface SyncChange {
  name: string;
  icon: string;
  /** Null deletes the set. */
  code: string | null;
  base: number;
}

export interface SyncRequest {
  cursor: number;
  label: string;
  changes: SyncChange[];
  rejected: string[];
}

export interface SyncedSet {
  name: string;
  icon: string;
  code: string | null;
  rev: number;
}

export interface SyncAnswer {
  cursor: number;
  more: boolean;
  acks: { name: string; rev: number }[];
  rejected: string[];
  sets: SyncedSet[];
}

const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");

function decode(text: string): string | null {
  return BASE64.test(text) ? Buffer.from(text, "base64").toString("utf8") : null;
}

function revision(text: string | undefined): number | null {
  if (!text || !/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

const lines = (body: string) => body.split(/\r?\n/).filter(Boolean);

/** The name a look is filed under: mo::CleanName, so the two sides agree on it. */
export function cleanSetName(title: string): string {
  const name = title.replace(/[[\]\r\n]/g, "").trim().slice(0, MAX_NAME).trim();
  return name || "Look";
}

const nameFits = (name: string) => name.length > 0 && name.length <= MAX_NAME && !UNSTORABLE.test(name) && cleanSetName(name) === name;

export function parseSyncRequest(body: string): SyncRequest | null {
  const [header, ...rest] = lines(body);
  if (header !== SYNC_HEADER) return null;

  const request: SyncRequest = { cursor: -1, label: "", changes: [], rejected: [] };
  for (const line of rest) {
    const [verb, ...fields] = line.split(" ");
    if (verb === "cursor" && fields.length === 1) {
      const cursor = revision(fields[0]);
      if (cursor === null) return null;
      request.cursor = cursor;
    } else if (verb === "label" && fields.length === 1) {
      const label = decode(fields[0]);
      if (label === null) return null;
      request.label = label.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME);
    } else if (verb === "put" && fields.length === 4) {
      const base = revision(fields[0]);
      const name = decode(fields[1]);
      const icon = fields[2] === "-" ? "" : decode(fields[2]);
      const code = fields[3];
      if (base === null || name === null || icon === null) return null;
      const fits = nameFits(name) && icon.length <= MAX_ICON && !UNSTORABLE.test(icon) && code.length <= MAX_CODE && LOOK_CODE.test(code);
      if (fits) request.changes.push({ name, icon, code, base });
      else request.rejected.push(name);
    } else if (verb === "del" && fields.length === 2) {
      const base = revision(fields[0]);
      const name = decode(fields[1]);
      if (base === null || name === null) return null;
      if (nameFits(name)) request.changes.push({ name, icon: "", code: null, base });
      else request.rejected.push(name);
    } else {
      return null;
    }
  }
  if (request.cursor < 0 || request.changes.length + request.rejected.length > MAX_CHANGES) return null;
  return request;
}

export function formatSyncAnswer({ cursor, more, acks, rejected, sets }: SyncAnswer): string {
  return [
    `ok ${cursor} ${more ? 1 : 0}`,
    ...acks.map((a) => `ack ${a.rev} ${encode(a.name)}`),
    ...rejected.map((name) => `rej ${encode(name)}`),
    ...sets.map((s) =>
      s.code === null
        ? `del ${s.rev} ${encode(s.name)}`
        : `set ${s.rev} ${encode(s.name)} ${s.icon ? encode(s.icon) : "-"} ${s.code}`,
    ),
  ].join("\n");
}

export function parseLinkRequest(body: string): { code: string; label: string } | null {
  let code = "";
  let label = "";
  for (const line of lines(body)) {
    const [verb, value] = line.split(" ");
    if (verb === "code" && value) code = value;
    if (verb === "label" && value) label = (decode(value) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME);
  }
  return code ? { code, label } : null;
}

export const SHOT_HEADER = "eclipse-shot 1";

/** The picture as the game sends it, before the site compresses it. */
export const MAX_SHOT_BYTES = 3 * 1024 * 1024;

export type ShotStatus =
  | "ok"
  | "unlinked"
  | "missing"
  | "set-full"
  | "account-full"
  | "busy"
  | "too-large"
  | "unreadable"
  | "bad-request"
  | "unavailable";

export function parseShotRequest(body: string): { name: string; image: Buffer } | null {
  const [header, ...rest] = lines(body);
  if (header !== SHOT_HEADER || rest.length !== 2) return null;
  let name: string | null = null;
  let image: Buffer | null = null;
  for (const line of rest) {
    const [verb, value, extra] = line.split(" ");
    if (extra !== undefined || !value) return null;
    if (verb === "set" && name === null) name = decode(value);
    else if (verb === "image" && image === null && BASE64.test(value)) image = Buffer.from(value, "base64");
    else return null;
  }
  if (name === null || !nameFits(name) || !image?.length) return null;
  return { name, image };
}

export function formatShotAnswer(answer: { status: ShotStatus; count?: number }): string {
  return answer.status === "ok" ? `ok ${answer.count ?? 0}` : answer.status;
}

export const VERSION_HEADER = "eclipse-version 1";

/** A version as it is shown and sent: no spaces, nothing the game must escape. */
export const VERSION_TEXT = /^[0-9A-Za-z.+-]{1,32}$/;

/** The build a version check names, or null for anything that is not one. */
export function parseVersionRequest(body: string): string | null {
  const [header, ...rest] = lines(body);
  if (header !== VERSION_HEADER) return null;
  for (const line of rest) {
    const [verb, value, extra] = line.split(" ");
    if (verb === "build" && value && extra === undefined && VERSION_TEXT.test(value)) return value;
  }
  return null;
}

/** The leading numbers of a version: "v1.10.2-beta" is [1, 10, 2]. Empty for "dev". */
function versionNumbers(version: string): number[] {
  const numbers: number[] = [];
  for (const part of version.replace(/^v/i, "").split(".")) {
    const n = /^\d+/.exec(part);
    if (!n) break;
    numbers.push(Number(n[0]));
    if (n[0] !== part) break;
  }
  return numbers;
}

/** Is `latest` a later version than `build`? Never, when either is not a version. */
export function isNewerBuild(latest: string, build: string): boolean {
  const a = versionNumbers(latest);
  const b = versionNumbers(build);
  if (!a.length || !b.length) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}
