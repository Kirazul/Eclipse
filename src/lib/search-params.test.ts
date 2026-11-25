import { describe, expect, it } from "vitest";
import { offered, wardrobeParsers } from "@/lib/search-params";

describe("the Wardrobe's author filter", () => {
  it("takes an account id", () => {
    const id = "6a96974b-3368-40f5-a474-5a31c69e798c";
    expect(wardrobeParsers.author.parse(id)).toBe(id);
  });

  it("drops anything else, because Postgres would reject it", () => {
    expect(wardrobeParsers.author.parse("not-a-uuid")).toBeNull();
  });
});

describe("the Gallery's filter choices", () => {
  const ALL = ["cloth", "leather", "mail", "plate"] as const;

  it("are only the values some look has, in their usual order", () => {
    expect(offered(ALL, ["plate", "cloth"], null)).toEqual(["cloth", "plate"]);
  });

  it("keep the value a link already chose, so old links still show what they filter by", () => {
    expect(offered(ALL, ["plate"], "mail")).toEqual(["mail", "plate"]);
  });

  it("are none when no look has any", () => {
    expect(offered(ALL, [], null)).toEqual([]);
  });
});

describe("the body filter", () => {
  it("takes male or female, and drops anything else", () => {
    expect(wardrobeParsers.sex.parse("female")).toBe("female");
    expect(wardrobeParsers.sex.parse("Female")).toBeNull();
  });
});
