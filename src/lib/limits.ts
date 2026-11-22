// Limits the forms show and the schemas enforce. Kept apart from the schemas, so a form can
// read a number without bringing zod to the browser (limits.test.ts).

/** The database's limit too (the look_comments migration). */
export const COMMENT_MAX = 500;

/** The database's limit for a look's description too (the look_description migration). */
export const DESCRIPTION_MAX = 500;

export const MAX_SCREENSHOTS = 6;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
