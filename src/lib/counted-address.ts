/**
 * The address a page view is counted under. What follows the page can hold a loadout's
 * code, a search or a sign-in's answer, and a private loadout's page holds its id: none of
 * them is needed to know which pages are used.
 */
export function countedAddress(url: string): string {
  const { origin, pathname } = new URL(url);
  return origin + pathname.replace(/^\/sets\/[^/]+/, "/sets/[id]");
}
