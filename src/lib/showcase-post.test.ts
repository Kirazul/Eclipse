import { describe, expect, it, vi } from "vitest";
import type { ShowcaseMessage } from "./showcase-post";

vi.mock("server-only", () => ({}));
const { codeAfter, codeIn, lookWithCode, pictureFor, said, titleOf } = await import("./showcase-post");

const PLAYER = { id: "354266414397390858", username: "shadow", global_name: "Shadow" };
const OTHER = { id: "708022303841058907", username: "kira", global_name: null };
const IMAGE = { url: "https://cdn.discordapp.com/attachments/1/2/shot.png", content_type: "image/png" };

let n = 0;
const message = (over: Partial<ShowcaseMessage>): ShowcaseMessage => ({
  id: `14000000000000000${String(++n).padStart(2, "0")}`,
  timestamp: "2026-11-10T12:00:00.000Z",
  content: "",
  author: PLAYER,
  attachments: [],
  ...over,
});

const pick = (code: ShowcaseMessage, history: ShowcaseMessage[]) =>
  pictureFor(code, new Map([...history, code].map((m) => [m.id, m])), history);

describe("a showcase post's code", () => {
  it("is found in the message, even when Discord wrapped it", () => {
    expect(codeIn("Here it is:\nECA1:c2xv\ndCAw ID EK")).toBe("ECA1:c2xvdCAwIDEK");
    expect(codeIn("no code here")).toBeNull();
  });

  it("leaves the code, mentions and custom emoji out of what the player said", () => {
    expect(said(message({ content: "Frost knight <:pog:123456> <@354266414397390858> ECA1:abc" }))).toBe("Frost knight");
  });
});

describe("a showcase post's picture", () => {
  it("is the code's own screenshots first", () => {
    const code = message({ content: "ECA1:abc", attachments: [IMAGE] });
    expect(pick(code, [])).toBe(code);
  });

  it("is the player's picture the code answers, through the replies", () => {
    const picture = message({ attachments: [IMAGE] });
    const ask = message({ author: OTHER, content: "code?", message_reference: { message_id: picture.id } });
    const code = message({ content: "ECA1:abc", message_reference: { message_id: ask.id } });
    expect(pick(code, [picture, ask])).toBe(picture);
  });

  it("is the player's last picture in the hour before, never someone else's", () => {
    const theirs = message({ attachments: [IMAGE], timestamp: "2026-11-10T11:30:00.000Z" });
    const others = message({ author: OTHER, attachments: [IMAGE], timestamp: "2026-11-10T11:50:00.000Z" });
    const code = message({ content: "ECA1:abc" });
    expect(pick(code, [theirs, others])).toBe(theirs);
  });

  it("is nothing when the player shared no picture of their own", () => {
    const old = message({ attachments: [IMAGE], timestamp: "2026-11-10T09:00:00.000Z" });
    const others = message({ author: OTHER, attachments: [IMAGE] });
    expect(pick(message({ content: "ECA1:abc" }), [old, others])).toBeNull();
  });
});

describe("a showcase post's title", () => {
  it("is a short caption as written", () => {
    expect(titleOf("bloodelf", "Sunwell guard")).toBe("Sunwell guard");
  });

  it("is named for the race when the caption is a sentence or missing", () => {
    expect(titleOf("bloodelf", "Here is my new look, hope you like it!")).toBe("Blood Elf transmog");
    expect(titleOf(null, "")).toBe("Transmog");
  });
});

describe("a picture's code, given later in the channel", () => {
  it("is the same player's, for that picture", () => {
    const picture = message({ attachments: [IMAGE] });
    const ask = message({ author: OTHER, content: "code?" });
    const code = message({ content: "ECA1:abc" });
    expect(codeAfter(picture, [ask, code])).toBe(code);
  });

  it("is not someone else's code, or the code of a newer picture", () => {
    const picture = message({ attachments: [IMAGE] });
    const theirs = message({ author: OTHER, content: "ECA1:abc" });
    const newer = message({ attachments: [IMAGE], timestamp: "2026-11-10T12:10:00.000Z" });
    const forNewer = message({ content: "ECA1:abc", timestamp: "2026-11-10T12:11:00.000Z" });
    expect(codeAfter(picture, [theirs, newer, forNewer])).toBeNull();
  });
});

describe("a look made from a picture and the code its player gave", () => {
  // A real code: Simple Spear in the main hand.
  const CODE = "ECA1:c2xvdCAxNSA0MjAK";
  const picture = message({ content: "Frost knight", attachments: [IMAGE, IMAGE] });
  const AT = "2026-11-22T10:00:00.000Z";

  it("is credited to the post's player, with its screenshots and caption, dated when given", () => {
    const made = lookWithCode(picture, ` ${CODE}\n`, null, AT);
    expect(made).toMatchObject({
      ok: true,
      look: { messageId: picture.id, discordId: PLAYER.id, name: "Shadow", title: "Frost knight", description: null, code: CODE, createdAt: AT },
    });
    expect(made.ok && made.look.pictures).toHaveLength(2);
  });

  it("takes the player's own title, and keeps what they wrote as its caption", () => {
    const made = lookWithCode(picture, CODE, "Warden of the North", AT);
    expect(made).toMatchObject({ ok: true, look: { title: "Warden of the North", description: "Frost knight" } });
  });

  it("is refused without a real code or a screenshot", () => {
    expect(lookWithCode(picture, "soon", null, AT)).toEqual({ ok: false, why: "code" });
    expect(lookWithCode(picture, "ECA1:AAAA", null, AT)).toEqual({ ok: false, why: "code" });
    expect(lookWithCode(message({}), CODE, null, AT)).toEqual({ ok: false, why: "picture" });
  });
});
