import { useEffect, useSyncExternalStore } from "react";
import type { Account } from "@/lib/data/types";

// The session cookie itself, not the short-lived ones a sign-in leaves on its way out.
export const SESSION_COOKIE =/(?:^|; )sb-[^=]+-auth-token(?:\.0)?=/;

export interface AccountState {
  account: Account | null;
  /** True until the answer is known, so a signed-in visitor is never offered "Sign in". */
  checking: boolean;
}

const CHECKING: AccountState = { account: null, checking: true };

/**
 * Who is signed in, asked once for the whole page: the header, the look menu and the
 * comments all read the same answer, and a change one of them makes (a new name) reaches
 * the others. A failed answer is not kept, so the next part to ask tries again.
 */
export function accountStore(fetchAccount: () => Promise<Account | null>, signedIn: () => boolean) {
  let state: AccountState = CHECKING;
  let request: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: AccountState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    load(): Promise<void> {
      if (!signedIn()) {
        // Signed out: whoever signs in next is asked about afresh.
        request = null;
        if (state.checking || state.account) publish({ account: null, checking: false });
        return Promise.resolve();
      }
      request ??= fetchAccount().then(
        (account) => publish({ account, checking: false }),
        () => {
          request = null;
          publish({ account: null, checking: false });
        },
      );
      return request;
    },
    set(account: Account | null) {
      publish({ account, checking: false });
    },
  };
}

const store = accountStore(
  async () => {
    const r = await fetch("/api/account");
    const body = r.ok ? ((await r.json()) as { account: Account | null }) : null;
    return body?.account ?? null;
  },
  () => SESSION_COOKIE.test(document.cookie),
);

const OFF: AccountState = { account: null, checking: false };

/**
 * Who is signed in. Visitors with no session cookie cost no request, and every part of a
 * page that asks shares one request. `checking` holds until the answer is known, so a
 * signed-in visitor is never offered "Sign in".
 */
export function useAccount(enabled = true) {
  const shared = useSyncExternalStore(store.subscribe, store.get, () => CHECKING);
  useEffect(() => {
    if (enabled) void store.load();
  }, [enabled]);
  const { account, checking } = enabled ? shared : OFF;
  return [account, store.set, checking] as const;
}
