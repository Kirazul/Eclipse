"use client";

import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { useAccount } from "@/lib/use-account";

/**
 * Under a look shared on Discord that nobody has claimed yet. Signing in with the Discord
 * account that posted it hands the look over (a database trigger matches the account), so
 * the prompt is only for signed-out visitors: a signed-in owner would already have it.
 */
export function ClaimPrompt({ author }: { author: string }) {
  const t = useTranslations("look");
  const path = usePathname();
  const [account, , checking] = useAccount();
  if (checking || account) return null;
  return (
    <p className="mt-0.5 text-sm text-ink-faint">
      {t.rich("claim", {
        author,
        signIn: (c) => (
          <a href={`/auth/login?provider=discord&next=${encodeURIComponent(path)}`} className="text-amber underline-offset-2 hover:underline">
            {c}
          </a>
        ),
      })}
    </p>
  );
}
