import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorIn } from "./errors";

// Where the errors an action can answer with are written.
const SOURCES = [
  "src/app/actions.ts",
  "src/lib/data/supabase.ts",
  "src/lib/data/builtin.ts",
  "src/lib/comments.ts",
  "src/lib/data/types.ts",
  "src/lib/publish-sets.ts",
  ...readdirSync("src/lib/codec").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => `src/lib/codec/${f}`),
];

/** Every sentence those files say, numbers filled in where a template has them. */
function sentences(): string[] {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(file, "utf8");
    for (const [, s] of text.matchAll(/"([A-Z][^"\n]* [^"\n]*[.!?])"/g)) found.add(s);
    for (const [, s] of text.matchAll(/`([A-Z][^`\n]* [^`\n]*[.!?])`/g)) found.add(s.replace(/\$\{[^}]+\}/g, "6"));
  }
  return [...found];
}

describe("errors in the reader's language", () => {
  it.each(sentences())("has Russian for %s", (message) => {
    const russian = errorIn("ru", message);
    expect(russian).not.toBe(message);
    expect(russian).toMatch(/[а-яё]/i);
  });

  it("leaves English as it is", () => {
    expect(errorIn("en", "Sign in to vote.")).toBe("Sign in to vote.");
  });

  it("keeps the number in a limit", () => {
    expect(errorIn("ru", "Keep it to 500 characters.")).toBe("Не длиннее 500 символов.");
  });

  it("passes on a message it does not know", () => {
    expect(errorIn("ru", "Something new.")).toBe("Something new.");
  });
});
