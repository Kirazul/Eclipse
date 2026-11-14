"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { setLookPrivate } from "@/app/actions";
import { useAccount } from "@/lib/use-account";

/**
 * The author's switch between public and private, beside Delete. Only the author sees
 * it; the database decides who may change a look either way.
 */
export function LookVisibility({ id, authorId, isPrivate }: { id: string; authorId: string | null; isPrivate: boolean }) {
  const [account] = useAccount();
  const [saving, startSaving] = useTransition();
  const router = useRouter();

  if (!account || !authorId || account.id !== authorId) return null;

  function toggle() {
    startSaving(async () => {
      const r = await setLookPrivate(id, !isPrivate);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(r.value ? "Only you can see this look now" : "Your look is back in the Community Gallery");
      router.refresh();
    });
  }

  const Icon = isPrivate ? Eye : EyeOff;
  return (
    <button type="button" className="pill" disabled={saving} onClick={toggle}>
      <Icon className="size-4" strokeWidth={1.5} aria-hidden />
      {saving ? "Saving" : isPrivate ? "Set to public" : "Set to private"}
    </button>
  );
}
