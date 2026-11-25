// Limits the forms show and the schemas enforce. Kept apart from the schemas, so a form can
// read a number without bringing zod to the browser (limits.test.ts).

/** The database's limit too (the look_comments migration). */
export const COMMENT_MAX = 500;

/** Comments a look's page shows at once: the newest, then older ones a page at a time. */
export const COMMENTS_PER_PAGE = 200;

/** The database's limit for a look's description too (the look_description migration). */
export const DESCRIPTION_MAX = 500;

/**
 * The longest code a new look, a pasted code or a Discord post may have: a game set's limit
 * (the game_sync migration), so a published look can always be sent to the game. Looks
 * published before it keep their longer codes (the new_codes_capped migration).
 */
export const CODE_MAX = 32768;

/** Pictures that may wait on an account's sets: the database's limit (the game_picture_budget migration). */
export const GAME_PICTURES_MAX = 60;

export const MAX_SCREENSHOTS = 6;
export const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
