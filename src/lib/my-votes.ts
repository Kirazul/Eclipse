/**
 * Builds `hasVoted(id)`. Every call made in the same tick shares one request, so a page of
 * cards asks once, not once per card. A visitor who is not signed in costs no request.
 */
export function voteReader(fetchVoted: (ids: string[]) => Promise<string[]>, signedIn: () => boolean) {
  let pending: Map<string, ((voted: boolean) => void)[]> | null = null;

  async function flush(batch: Map<string, ((voted: boolean) => void)[]>) {
    let voted = new Set<string>();
    try {
      voted = new Set(await fetchVoted([...batch.keys()]));
    } catch {
      // Unknown reads as not voted: the button still works, it just starts unlit.
    }
    for (const [id, waiting] of batch) for (const resolve of waiting) resolve(voted.has(id));
  }

  return function hasVoted(id: string): Promise<boolean> {
    if (!signedIn()) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (!pending) {
        const batch = new Map<string, ((voted: boolean) => void)[]>();
        pending = batch;
        setTimeout(() => {
          pending = null;
          void flush(batch);
        }, 0);
      }
      const waiting = pending.get(id) ?? [];
      waiting.push(resolve);
      pending.set(id, waiting);
    });
  };
}
