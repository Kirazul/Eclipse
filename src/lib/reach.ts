/** The answer a form shows when a server action never answered. */
export type Unreached = { ok: false; error: string };

/**
 * A server action's own answer, or `{ ok: false, error }` when none came back: a dropped
 * connection or a server that failed outright. Inside startTransition a thrown action
 * reaches the error page and takes what the visitor typed with it; this way the form shows
 * the failure the way it shows any other, and keeps its fields.
 */
export async function reach<T>(call: () => Promise<T>, error: string): Promise<T | Unreached> {
  try {
    return await call();
  } catch (failure) {
    console.error(failure);
    return { ok: false, error };
  }
}
