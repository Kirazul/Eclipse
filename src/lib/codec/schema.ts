import { z } from "zod";
import { NAME_MAX } from "@/lib/account";
import { descriptionSchema } from "@/lib/comments";
import { ARMOR_TYPES, CLASSES, RACE_LABEL } from "@/lib/domain";
import { MAX_SCREENSHOTS } from "@/lib/limits";
import { UPLOAD_PATH } from "@/lib/screenshots";
import { decodeOutfit } from "./outfit";

/** A loadout code the game would read, or the game's reason it would not. */
export const outfitCodeSchema = z.string().superRefine((text, ctx) => {
  const r = decodeOutfit(text);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.error });
});

// A post only shows files uploaded here: an outside link would show unmoderated
// images and tell another site's owner who is looking at them.
const upload = z.string().regex(UPLOAD_PATH, "Upload screenshots from this computer.");

export const submitOutfitSchema = z.object({
  title: z.string().trim().min(3, "Give it a title of at least 3 letters.").max(80),
  code: outfitCodeSchema,
  className: z.enum(CLASSES).optional(),
  armor: z.enum(ARMOR_TYPES).optional(),
  race: z.enum(Object.keys(RACE_LABEL) as [string, ...string[]]).optional(),
  // No longer typed on the publish form; the database adds the code's own (mount, enchant).
  tags: z.array(z.string().trim().min(1).max(24)).max(6).default([]),
  /** The author's caption, shown with the comments. */
  description: descriptionSchema.optional(),
  // Every look in the Gallery opens on how the game drew it, so a screenshot is required.
  // No default: a missing gallery must fail, not become an empty one.
  gallery: z
    .array(upload, { error: "Add at least one screenshot." })
    .min(1, "Add at least one screenshot.")
    .max(MAX_SCREENSHOTS, `Keep it to ${MAX_SCREENSHOTS} screenshots.`),
  /** The published look this was made from, credited on the new one. */
  remixedFrom: z.uuid().optional(),
});
export type SubmitOutfit = z.input<typeof submitOutfitSchema>;
export type ParsedOutfit = z.output<typeof submitOutfitSchema>;

// Letters and numbers from any script, with the marks that combine with them.
// Invisible characters are out: they make two different names look the same.
export const displayNameSchema = z
  .string()
  .trim()
  .min(2, "Use at least 2 characters.")
  .max(NAME_MAX, `Keep it to ${NAME_MAX} characters.`)
  .regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N} ._'-]*$/u, "Use letters, numbers, spaces and . _ ' - only.");
