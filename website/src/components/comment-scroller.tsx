"use client";

import { useEffect, useRef } from "react";

/**
 * The comments' own scroll area. It opens at the top, as a social app's does, and
 * follows a newly posted comment to the bottom so the writer sees it land.
 */
export function CommentScroller({ count, children }: { count: number; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const seen = useRef(count);

  useEffect(() => {
    if (count > seen.current) box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
    seen.current = count;
  }, [count]);

  return (
    <div ref={box} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
      {children}
    </div>
  );
}
