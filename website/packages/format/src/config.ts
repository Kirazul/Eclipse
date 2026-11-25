/**
 * Public, non-secret deployment facts. Secrets (R2 keys, Pages token) live only
 * in GitHub Actions secrets.
 */
export const R2 = {
  // eclipse-web: the bake's bucket, account and upload endpoint are left out. Only the
  // Eclipse-Viewer bake writes packs; this site only reads them.
  /**
   * Public read URL for development. Cloudflare rate-limits r2.dev and gives it
   * no edge cache, so launch moves to a custom domain: change this one value.
   */
  publicBase: "https://pub-8475da48fc7347d690ebb4e8e0254fdd.r2.dev",
};

/** Eclipse's pinned retail build. A model and its .anim must share a build. */
export const BUILD = {
  version: "12.1.0.69933",
  buildConfig: "dcfc90fffd79ba00406ae46f5f657592",
  cdnConfig: "a9035bfebbe53afc0f656dd89f22df69",
  cdnHosts: ["us.cdn.blizzard.com", "eu.cdn.blizzard.com", "level3.blizzard.com"],
  cdnPath: "tpr/wow",
};
