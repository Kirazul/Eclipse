import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // tsconfig leaves JSX to Next, which a test that renders a page does not have.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    // The *-sql tests each start a Postgres (PGlite) per test. Run all at once, starting
    // one can wait past the 10 s default on a busy machine, though it passes alone.
    hookTimeout: 30_000,
  },
});
