import { z } from "zod";
import { COMMENT_MAX, DESCRIPTION_MAX } from "@/lib/limits";

/** Further back than any look's comments go; a larger number is not a page. */
const MAX_COMMENT_PAGE = 10_000;

/**
 * The page of a look's comments a link asks for (?comments=), counted back from the
 * newest, which is page 1 and what a look opens on.
 */
export function commentPage(param: string | string[] | undefined): number {
  const value = Array.isArray(param) ? param[0] : param;
  if (!value || !/^[1-9][0-9]*$/.test(value)) return 1;
  const page = Number(value);
  return page <= MAX_COMMENT_PAGE ? page : 1;
}

/**
 * Text as the database stores a comment or a description: trimmed, with plain line
 * breaks, at most one blank line in a row, and no invisible control characters.
 */
export const cleanText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \n]+|[ \n]+$/g, "");

export const commentSchema = z
  .string()
  .transform(cleanText)
  .pipe(
    z
      .string()
      .min(1, "Write something first.")
      .max(COMMENT_MAX, `Keep it to ${COMMENT_MAX} characters.`),
  );

/** Optional: blank is no description at all. */
export const descriptionSchema = z
  .string()
  .optional()
  .transform((text) => cleanText(text ?? ""))
  .pipe(z.string().max(DESCRIPTION_MAX, `Keep the description to ${DESCRIPTION_MAX} characters.`))
  .transform((text) => text || undefined);
