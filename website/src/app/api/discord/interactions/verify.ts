// Discord signs every interaction it sends with Ed25519, over the timestamp header
// followed by the raw body. Anything that fails this check did not come from Discord.

const hex = (text: string) =>
  /^(?:[0-9a-f]{2})+$/i.test(text) ? Uint8Array.from(text.match(/../g)!, (b) => parseInt(b, 16)) : null;

export async function verifyDiscord(
  publicKey: string,
  signature: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  const key = hex(publicKey);
  const sig = signature ? hex(signature) : null;
  if (!key || key.length !== 32 || !sig || sig.length !== 64 || !timestamp) return false;
  try {
    const verifier = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", verifier, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
