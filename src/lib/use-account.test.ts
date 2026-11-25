import { describe, expect, it, vi } from "vitest";
import type { Account } from "@/lib/data/types";
import { accountStore } from "./use-account";

const KIRA = { id: "a", name: "Kira" } as Account;

describe("who is signed in", () => {
  it("is asked once for every part of the page that wants to know", async () => {
    const fetch = vi.fn(async () => KIRA);
    const store = accountStore(fetch, () => true);
    await Promise.all([store.load(), store.load(), store.load(), store.load()]);
    await store.load();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ account: KIRA, checking: false });
  });

  it("is checking until the answer comes, so nobody is offered Sign in too early", async () => {
    let answer!: (a: Account) => void;
    const store = accountStore(() => new Promise((resolve) => (answer = resolve)), () => true);
    const loading = store.load();
    expect(store.get()).toEqual({ account: null, checking: true });
    answer(KIRA);
    await loading;
    expect(store.get().checking).toBe(false);
  });

  it("costs a visitor with no session no request", async () => {
    const fetch = vi.fn(async () => KIRA);
    const store = accountStore(fetch, () => false);
    await store.load();
    expect(fetch).not.toHaveBeenCalled();
    expect(store.get()).toEqual({ account: null, checking: false });
  });

  it("tells everyone of a change, such as a new name", async () => {
    const store = accountStore(async () => KIRA, () => true);
    await store.load();
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.set({ ...KIRA, name: "Kirazul" });
    expect(heard).toHaveBeenCalledOnce();
    expect(store.get().account?.name).toBe("Kirazul");
    stop();
    store.set(null);
    expect(heard).toHaveBeenCalledOnce();
  });

  it("asks again after a failed answer, rather than keeping the failure", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(KIRA);
    const store = accountStore(fetch, () => true);
    await store.load();
    expect(store.get()).toEqual({ account: null, checking: false });
    await store.load();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.get().account).toEqual(KIRA);
  });

  it("asks again after signing out and back in", async () => {
    let session = true;
    const fetch = vi.fn(async () => KIRA);
    const store = accountStore(fetch, () => session);
    await store.load();
    session = false;
    await store.load();
    expect(store.get()).toEqual({ account: null, checking: false });
    session = true;
    await store.load();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.get().account).toEqual(KIRA);
  });
});
