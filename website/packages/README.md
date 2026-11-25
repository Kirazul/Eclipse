# Vendored from Eclipse-Viewer

`engine/` and `format/` are copied from [Kirazul/Eclipse-Viewer](https://github.com/Kirazul/Eclipse-Viewer)
at commit `c02fe3f` (2026-11-05), used with the author's permission. They are Kirazul's and are not
covered by the MIT License at the root of this repository. The viewer's bake
publishes the packs these read; this site only reads them (`src/lib/viewer/pack.ts`).

Local changes, to carry over on every sync:

- `format/src/config.ts`: the bake's bucket, account id and upload endpoint are removed.
- `engine/package.json`: `three` follows this site's version; the `copy-public` script is
  replaced by `tools/copy-engine-assets.mjs`.
- `engine/test/fx.test.ts`: the two "allocates nothing while it runs" tests have a 30 s
  timeout. They run tens of thousands of frames and timed out at the default 5 s when the
  site's whole suite ran in parallel.

To sync, copy `engine/src`, `engine/test` and `packages/format/src` from a newer commit,
reapply the changes above, update the commit here, and run the four checks in CLAUDE.md.
