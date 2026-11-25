import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackError, fetchBytes } from "../src/net/fetchPack";

/** A fetch that answers when told to, so what is on a socket at any moment can be read. */
function fakeNet() {
  const open: { url: string; answer(status?: number, bytes?: number): void; fail(err: unknown): void; signal?: AbortSignal }[] = [];
  const asked: string[] = [];
  const fn = vi.fn(
    (url: string, init: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        asked.push(url);
        const signal = init.signal ?? undefined;
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        open.push({
          url,
          signal,
          answer: (status = 200, bytes = 4) => resolve(new Response(status === 200 ? new Uint8Array(bytes) : null, { status })),
          fail: reject,
        });
      }),
  );
  return { fn, open, asked };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the pack queue", () => {
  let net: ReturnType<typeof fakeNet>;
  beforeEach(() => {
    net = fakeNet();
    vi.stubGlobal("fetch", net.fn);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("two asks for one URL are one request, and each asker can keep its buffer", async () => {
    const a = fetchBytes("http://p/one", { expected: 4 });
    const b = fetchBytes("http://p/one", { expected: 4 });
    await tick();
    expect(net.asked).toEqual(["http://p/one"]);
    net.open[0]!.answer();
    const [x, y] = await Promise.all([a, b]);
    expect(x.byteLength).toBe(4);
    expect(x).not.toBe(y);
  });

  it("never holds more than six sockets, and a newer high priority wish passes what waits", async () => {
    const all = Array.from({ length: 8 }, (_, i) => fetchBytes(`http://p/${i}`, { priority: "auto" }));
    const urgent = fetchBytes("http://p/now", { priority: "high" });
    await tick();
    expect(net.open.length).toBe(6);
    net.open[0]!.answer();
    await all[0];
    await tick();
    expect(net.asked[6]).toBe("http://p/now");
    for (const o of net.open.slice(1)) o.answer();
    await urgent;
    while (net.open.length < 9) await tick();
    net.open[7]!.answer();
    net.open[8]!.answer();
    await Promise.all(all);
  });

  it("a request nobody wants before it has a socket never goes out", async () => {
    const hold = Array.from({ length: 6 }, (_, i) => fetchBytes(`http://h/${i}`));
    const abort = new AbortController();
    const gone = fetchBytes("http://p/gone", { signal: abort.signal });
    abort.abort();
    await expect(gone).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    for (const o of [...net.open]) o.answer();
    await Promise.all(hold);
    await tick();
    expect(net.asked).not.toContain("http://p/gone");
  });

  it("one that has a socket finishes: its asker hears at once, and the socket isn't cut", async () => {
    const abort = new AbortController();
    const asked = fetchBytes("http://p/running", { signal: abort.signal, expected: 1024, finish: true });
    await tick();
    abort.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(net.open[0]!.signal?.aborted).toBe(false);
    // Someone asking again joins it instead of asking twice.
    const again = fetchBytes("http://p/running");
    await tick();
    expect(net.asked.filter((u) => u === "http://p/running").length).toBe(1);
    net.open[0]!.answer(200, 1024);
    expect((await again).byteLength).toBe(1024);
  });

  it("a big one with much left to come is cut", async () => {
    const abort = new AbortController();
    const asked = fetchBytes("http://p/big", { signal: abort.signal, expected: 4 * 1024 * 1024, finish: true });
    await tick();
    abort.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(net.open[0]!.signal?.aborted).toBe(true);
    net.open[0]!.answer();
  });

  it("without `finish`, a request nobody wants is cut at once", async () => {
    const abort = new AbortController();
    const asked = fetchBytes("http://p/body", { signal: abort.signal, expected: 1024 });
    await tick();
    abort.abort();
    await expect(asked).rejects.toMatchObject({ name: "AbortError" });
    expect(net.open[0]!.signal?.aborted).toBe(true);
    net.open[0]!.answer();
  });

  it("asks again after a failure the host can recover from, not after a 404", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const flaky = fetchBytes("http://p/flaky");
    await vi.advanceTimersByTimeAsync(0);
    net.open[0]!.answer(503);
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.asked.filter((u) => u === "http://p/flaky").length).toBe(2);
    net.open[1]!.answer(200, 8);
    expect((await flaky).byteLength).toBe(8);

    const missing = fetchBytes("http://p/missing");
    missing.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    net.open[2]!.answer(404);
    await expect(missing).rejects.toBeInstanceOf(PackError);
    await vi.advanceTimersByTimeAsync(2000);
    expect(net.asked.filter((u) => u === "http://p/missing").length).toBe(1);
  });

  it("a socket gone quiet is asked again, as a figure waiting on it would never stand", async () => {
    vi.useFakeTimers();
    const got = fetchBytes("http://p/quiet", { expected: 4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(net.asked).toEqual(["http://p/quiet"]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(net.asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(net.asked).toEqual(["http://p/quiet", "http://p/quiet"]);
    expect(net.open[0]!.signal!.aborted).toBe(true);
    net.open[1]!.answer();
    await vi.advanceTimersByTimeAsync(0);
    expect((await got).byteLength).toBe(4);
  });

  it("a socket that never answers fails in the end, and says so", async () => {
    vi.useFakeTimers();
    const got = fetchBytes("http://p/gone", { expected: 4 });
    const failed = got.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.asked).toHaveLength(5);
    expect(await failed).toBeInstanceOf(PackError);
    expect(((await failed) as PackError).status).toBe(408);
  });

  it("cutting a request still cuts what is on its socket", async () => {
    const stop = new AbortController();
    const got = fetchBytes("http://p/cut", { signal: stop.signal });
    await tick();
    stop.abort();
    await expect(got).rejects.toMatchObject({ name: "AbortError" });
    expect(net.open.at(-1)!.signal!.aborted).toBe(true);
  });

  it("gives up after its retries and says so", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const down = fetchBytes("http://p/down");
    down.catch(() => undefined);
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(1000);
      net.open.at(-1)!.answer(500);
    }
    await vi.advanceTimersByTimeAsync(1000);
    await expect(down).rejects.toBeInstanceOf(PackError);
    expect(net.asked.filter((u) => u === "http://p/down").length).toBe(3);
  });
});
