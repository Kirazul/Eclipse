/**
 * Every pack goes through here: priority hints, abort, a byte count taken from the
 * stream itself so progress is accurate on any connection, and one queue.
 *
 * The queue is what a wearable's speed comes down to. r2.dev speaks HTTP/1.1 only, so
 * a page has six sockets, each with about 250 ms to its first byte, and the browser's
 * own queue can't be reordered. So requests wait here, where a newer wish can pass them:
 *  - a request nobody wants any more before it has a socket simply never goes out;
 *  - a wearable's request that already has a socket finishes (`finish`), because cutting
 *    it costs a new TLS handshake, the pointer often comes straight back, and its bytes are
 *    immutable and land in the HTTP cache anyway. Only a big one with much left is cut;
 *  - two asks for one URL are one request;
 *  - a failure the host can recover from (R2 answers a burst with 5xx, or drops a
 *    connection) is asked again rather than failing a wearable;
 *  - so is a socket gone quiet: on a congested line one can sit for minutes with no byte
 *    and no error, and a figure waiting on one file doesn't stand at all.
 */
export class PackError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`pack ${url} answered ${status}`);
    this.name = "PackError";
  }
}

/** A socket that went quiet. Asked again on its own count, and the same to anyone who sees it fail. */
class Stalled extends PackError {
  constructor(url: string) {
    super(url, 408);
  }
}

export interface FetchOptions {
  signal?: AbortSignal;
  priority?: "high" | "low" | "auto";
  /** Called for each chunk with its length. */
  onBytes?: (n: number) => void;
  /** Known size, so the buffer is allocated once. */
  expected?: number;
  /**
   * Among the same priority, lower goes first: one wearable's files together, so a set's
   * pieces finish one after another and show as they do, instead of all at the very end.
   */
  group?: number;
  /** Nobody wants it any more but it has a socket: let it finish rather than cut the connection. */
  finish?: boolean;
}

/** The browser's limit per HTTP/1.1 host. Above it a request waits where it can't be passed. */
const SOCKETS = 6;
/** What low priority may hold: a request already on a socket can't be passed, so the rest stay free. */
const LOW_SOCKETS = 3;
/** Waits before asking again. */
const RETRY_MS = [300, 900];
/** No byte for this long, and the socket is lost. r2.dev's slowest first byte seen is 2.5 s. */
const STALL_MS = 10_000;
/** How many times a quiet socket is asked again before it counts as a failure. */
const STALLS = 4;
/** With more than this left to come, a request nobody wants is cut, socket or not. */
const WORTH_CUTTING = 256 * 1024;

const RANK = { high: 0, auto: 1, low: 2 } as const;

interface Job {
  url: string;
  rank: number;
  group: number;
  seq: number;
  expected: number;
  listeners: ((n: number) => void)[];
  waiters: number;
  running: boolean;
  attempts: number;
  stalls: number;
  received: number;
  finish: boolean;
  /** Counted as low priority while it holds its socket, whatever it has been raised to since. */
  onLowSocket: boolean;
  cut: AbortController;
  done: Promise<ArrayBuffer>;
  resolve: (b: ArrayBuffer) => void;
  reject: (e: unknown) => void;
}

const jobs = new Map<string, Job>();
const queued: Job[] = [];
let running = 0;
let runningLow = 0;
let seq = 0;

const abortError = () => new DOMException("The request was aborted", "AbortError");

/** High and normal requests in the order they were asked; among low ones, the newest wish first. */
function before(a: Job, b: Job): boolean {
  if (a.rank !== b.rank) return a.rank < b.rank;
  if (a.group !== b.group) return a.group < b.group;
  return a.rank === RANK.low ? a.seq > b.seq : a.seq < b.seq;
}

function pump(): void {
  while (running < SOCKETS && queued.length) {
    let best = 0;
    for (let i = 1; i < queued.length; i++) if (before(queued[i]!, queued[best]!)) best = i;
    const job = queued[best]!;
    // The best one left is low priority, and that has its share already: the rest wait for a wish.
    if (job.rank === RANK.low && runningLow >= LOW_SOCKETS) return;
    queued.splice(best, 1);
    job.running = true;
    running++;
    job.onLowSocket = job.rank === RANK.low;
    if (job.onLowSocket) runningLow++;
    void start(job);
  }
}

function transient(err: unknown): boolean {
  if (err instanceof PackError) return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  return (err as { name?: string } | null)?.name === "TypeError";
}

async function start(job: Job): Promise<void> {
  const forget = () => {
    if (jobs.get(job.url) === job) jobs.delete(job.url);
  };
  try {
    const bytes = await read(job);
    forget();
    job.resolve(bytes);
  } catch (err) {
    const lost = err instanceof Stalled;
    const again = job.waiters > 0 && (lost ? job.stalls++ < STALLS : transient(err) && job.attempts < RETRY_MS.length);
    if (again) {
      const wait = lost ? 0 : RETRY_MS[job.attempts++]!;
      job.received = 0;
      job.running = false;
      setTimeout(() => {
        if (job.waiters > 0) queued.push(job);
        else {
          forget();
          job.reject(abortError());
        }
        pump();
      }, wait);
    } else {
      forget();
      job.reject(err);
    }
  } finally {
    running--;
    if (job.onLowSocket) runningLow--;
    pump();
  }
}

async function read(job: Job): Promise<ArrayBuffer> {
  // This attempt's own line: a job that is cut stays cut, one that went quiet is asked again.
  const line = new AbortController();
  const cut = () => line.abort();
  job.cut.signal.addEventListener("abort", cut, { once: true });
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      line.abort();
    }, STALL_MS);
  };
  alive();
  try {
    // The default credentials: the only ones a <link rel=preload> can match, and cross-origin
    // they send nothing either.
    const res = await fetch(job.url, {
      signal: line.signal,
      priority: job.rank === RANK.high ? "high" : job.rank === RANK.low ? "low" : "auto",
    } as RequestInit);
    if (!res.ok) throw new PackError(job.url, res.status);
    if (!res.body) {
      const all = await res.arrayBuffer();
      for (const on of job.listeners) on(all.byteLength);
      return all;
    }
    const reader = res.body.getReader();
    let out = new Uint8Array(job.expected > 0 ? job.expected : 65536);
    let used = 0;
    for (;;) {
      alive();
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.length > out.length) {
        const grown = new Uint8Array(Math.max(out.length * 2, used + value.length));
        grown.set(out.subarray(0, used));
        out = grown;
      }
      out.set(value, used);
      used += value.length;
      job.received = used;
      for (const on of job.listeners) on(value.length);
    }
    return used === out.length ? out.buffer : out.buffer.slice(0, used);
  } catch (err) {
    throw stalled ? new Stalled(job.url) : err;
  } finally {
    clearTimeout(timer);
    job.cut.signal.removeEventListener("abort", cut);
  }
}

/** One asker has gone. The request itself stops only if that costs nothing or saves much. */
function leave(job: Job): void {
  job.waiters--;
  if (job.waiters > 0) return;
  if (!job.running) {
    const at = queued.indexOf(job);
    if (at >= 0) queued.splice(at, 1);
    jobs.delete(job.url);
    job.reject(abortError());
    return;
  }
  if (!job.finish || job.expected - job.received > WORTH_CUTTING) {
    // Whoever asks next starts over, rather than joining what is being cut.
    jobs.delete(job.url);
    job.cut.abort();
  }
}

/** What the queue holds right now: what the proofs read when a wear is slow. */
export function queueState(): { running: number; runningLow: number; queued: number; onSockets: string[] } {
  return { running, runningLow, queued: queued.length, onSockets: [...jobs.values()].filter((j) => j.running).map((j) => `${j.rank}:${j.waiters}:${j.received}:${j.url.slice(-28)}`) };
}

export function fetchBytes(url: string, opts: FetchOptions = {}): Promise<ArrayBuffer> {
  const { signal } = opts;
  if (signal?.aborted) return Promise.reject(abortError());
  const rank = RANK[opts.priority ?? "auto"];
  let job = jobs.get(url);
  const group = opts.group ?? 0;
  if (job) {
    if (rank < job.rank) job.rank = rank;
    if (group < job.group) job.group = group;
    if (opts.finish) job.finish = true;
  } else {
    let resolve!: (b: ArrayBuffer) => void;
    let reject!: (e: unknown) => void;
    const done = new Promise<ArrayBuffer>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Everyone waiting may have left by the time it settles.
    done.catch(() => undefined);
    job = { url, rank, group, seq: ++seq, expected: opts.expected ?? 0, listeners: [], waiters: 0, running: false, attempts: 0, stalls: 0, received: 0, finish: opts.finish ?? false, onLowSocket: false, cut: new AbortController(), done, resolve, reject };
    jobs.set(url, job);
    queued.push(job);
  }
  const mine = job;
  mine.waiters++;
  if (opts.onBytes) mine.listeners.push(opts.onBytes);
  pump();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    let live = true;
    const onAbort = () => {
      if (!live) return;
      live = false;
      leave(mine);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    mine.done.then(
      (bytes) => {
        if (!live) return;
        live = false;
        signal?.removeEventListener("abort", onAbort);
        // A decoder may take the buffer for itself: only the last asker gets the original.
        mine.waiters--;
        resolve(mine.waiters > 0 ? bytes.slice(0) : bytes);
      },
      (err) => {
        if (!live) return;
        live = false;
        signal?.removeEventListener("abort", onAbort);
        mine.waiters--;
        reject(err);
      },
    );
  });
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const bytes = await fetchBytes(url, opts);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError";
}

/** Gives the browser a turn between steps, so a load never holds the main thread. */
export function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });
}
