"use client";

import { UserRound } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import type { Account } from "@/lib/data/types";

/** The provider's picture. A provider's link can go stale, so it falls back to an initial. */
export function Avatar({ account, size = 26 }: { account: Pick<Account, "avatar" | "name">; size?: number }) {
  const [broken, setBroken] = useState(false);
  // Array.from keeps an emoji in one piece.
  const initial = Array.from(account.name?.trim() ?? "")[0]?.toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {account.avatar && !broken ? (
        // No optimizer: the provider's host already serves it small, and it sits outside our image config.
        // No referrer: Google refuses some picture requests that carry one.
        <Image
          src={account.avatar}
          width={size}
          height={size}
          alt=""
          unoptimized
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : initial ?? <UserRound aria-hidden="true" />}
    </span>
  );
}
