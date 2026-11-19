"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { copiedLook } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

const CONFIRM_MS = 1800;

export function CopyButton({
  code,
  look,
  label = "Copy code",
  toastTitle = "Code copied",
  toastHint = "Paste it with Import in the game.",
  variant = "default",
  className,
}: {
  code: string;
  /** The look this code belongs to, so the copy counts toward its card. */
  look?: string;
  label?: string;
  toastTitle?: string;
  toastHint?: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(event: React.MouseEvent) {
    // Cards are links; a copy must not open the drawer as well.
    event.preventDefault();
    event.stopPropagation();
    if (!(await copyText(code))) {
      toast.error("The browser refused the clipboard. Select the code and copy it by hand.");
      return;
    }
    setCopied(true);
    // Counting is the server's job and never the visitor's problem: a failure stays silent.
    if (look) copiedLook(look).catch(() => {});
    toast.success(toastTitle, { description: toastHint });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS);
  }

  return (
    <Button
      type="button"
      size="sm"
      variant={variant}
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      className={cn("nums min-w-28 gap-1.5", className)}
    >
      {copied ? <Check className="size-4" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.5} />}
      {copied ? "Copied" : label}
    </Button>
  );
}
