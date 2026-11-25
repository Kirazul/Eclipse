import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HELP } from "@/lib/help";
import GuidePage from "./page";

describe("the guide's help", () => {
  const html = renderToStaticMarkup(GuidePage());

  it("lists every common problem under one anchor the bot links to", () => {
    expect(html).toContain('id="help"');
    for (const h of HELP) expect(html).toContain(h.question);
  });

  it("shows a setting or file name as code, not as backticks", () => {
    expect(html).toContain("<code>WTF/Config.wtf</code>");
    expect(html).not.toContain("`");
  });
});
