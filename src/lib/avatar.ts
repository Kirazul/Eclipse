/** A Discord picture at the size it is drawn, from Discord's own resizer. Sizes are powers of two. */
export const sizedAvatar = (url: string | null, size: 64 | 128 | 256 = 64) => (url ? `${url}?size=${size}` : null);
