import { useEffect, useState } from "react";
import type { Account } from "@/lib/data/types";

// The session cookie itself, not the short-lived ones a sign-in leaves on its way out.
export const SESSION_COOKIE =/(?:^|; )sb-[^=]+-auth-token(?:\.0)?=/;

/**
 * Who is signed in. Visitors with no session cookie cost no request. `checking` holds
 * until the answer is known, so a signed-in visitor is never offered "Sign in".
 */
export function useAccount(enabled = true) {
  const [account, setAccount] = useState<Account | null>(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    if (!enabled || !SESSION_COOKIE.test(document.cookie)) {
      setChecking(false);
      return;
    }
    const request = new AbortController();
    fetch("/api/account", { signal: request.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { account: Account | null } | null) => {
        setAccount(body?.account ?? null);
        setChecking(false);
      })
      .catch(() => {
        if (!request.signal.aborted) setChecking(false);
      });
    return () => request.abort();
  }, [enabled]);
  return [account, setAccount, checking] as const;
}
