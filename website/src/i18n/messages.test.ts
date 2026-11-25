import { describe, expect, it } from "vitest";
import en from "./messages/en.json";
import ru from "./messages/ru.json";

// Russian must say everything English says, with the same {placeholders} and the same
// `code` spans, so no page shows a raw key and no value goes missing from a sentence.

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([key, value]) =>
      typeof value === "string" ? [[prefix + key, value]] : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

/** The top-level {names} a message fills in; plural branches' own text is not one. */
function placeholders(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === "{") {
      if (depth === 0) names.add(/^\{(\w+)/.exec(message.slice(i))?.[1] ?? "");
      depth++;
    } else if (message[i] === "}") depth--;
  }
  return [...names].sort();
}

const codeSpans = (message: string) => (message.match(/`[^`]+`/g) ?? []).sort();

const english = flatten(en as Tree);
const russian = flatten(ru as Tree);

describe("the Russian messages", () => {
  it("have every English key and nothing else", () => {
    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  });

  it("fill in the same values as the English", () => {
    for (const key of Object.keys(english)) {
      expect({ key, names: placeholders(russian[key] ?? "") }).toEqual({ key, names: placeholders(english[key]) });
    }
  });

  it("keep file names, settings and commands as written", () => {
    for (const key of Object.keys(english)) {
      expect({ key, code: codeSpans(russian[key] ?? "") }).toEqual({ key, code: codeSpans(english[key]) });
    }
  });

  it("say something in every message", () => {
    for (const [key, value] of Object.entries(russian)) expect({ key, empty: !value.trim() }).toEqual({ key, empty: false });
  });
});
