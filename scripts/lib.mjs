// Shared checks for the directory: manifest shape, licenses, and the
// signature rule the app uses (ed25519 over the SHA-256 digest bytes of the
// canonical content; the key is a Holochain AgentPubKey string).
import nacl from "tweetnacl";
import { createHash } from "node:crypto";

export const LICENSES = ["CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0", "MIT", "Apache-2.0", "GPL-3.0-or-later", "GPL-2.0-or-later"];
export const KINDS = ["character", "skill", "mcp"];
/** Folder per kind in this repo and on the site. */
export const KIND_DIRS = { character: "characters", skill: "skills", mcp: "tools" };
export const MAX_PACK_BYTES = 2 * 1024 * 1024;
export const MAX_SKILL_ZIP_BYTES = 50 * 1024 * 1024;

export function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** 'u' + base64url(no pad) of 39 bytes: 3-byte prefix, 32-byte key, 4-byte location. */
export function agentKeyToEd25519(agentPubKey) {
  const s = agentPubKey.startsWith("u") ? agentPubKey.slice(1) : agentPubKey;
  const raw = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (raw.length !== 39) throw new Error("agent key is not 39 bytes");
  return new Uint8Array(raw.subarray(3, 35));
}

/** Same canonical JSON the app hashes for an AI pack (aiPack.ts manifestHash). */
export function packDigest(pack) {
  const canonical = JSON.stringify({
    format: pack.format,
    version: pack.version,
    name: pack.name,
    description: pack.description,
    baseArchetypeId: pack.baseArchetypeId,
    systemPrompt: pack.systemPrompt,
    askBlurb: pack.askBlurb ?? "",
    emoji: pack.emoji ?? "",
    useEmojis: pack.useEmojis ?? null,
    lengthDisposition: pack.lengthDisposition ?? "",
    defaultMode: pack.defaultMode ?? "",
    thumbnail: pack.thumbnail ?? "",
    knowledge: pack.knowledge.map((e) => e.text),
  });
  return createHash("sha256").update(Buffer.from(canonical, "utf8")).digest();
}

/** ed25519 verify of `digestBytes` with the pack-style signature object. */
export function verifySignature(signature, digestBytes) {
  if (!signature || signature.algo !== "ed25519" || !signature.value || !signature.agent_pub_key) return false;
  try {
    const pk = agentKeyToEd25519(signature.agent_pub_key);
    const sig = new Uint8Array(Buffer.from(signature.value, "base64"));
    if (sig.length !== 64) return false;
    return nacl.sign.detached.verify(new Uint8Array(digestBytes), sig, pk);
  } catch {
    return false;
  }
}

export function checkManifest(m) {
  const errors = [];
  const need = (k, t) => {
    if (m[k] === undefined || m[k] === null || (t && typeof m[k] !== t)) errors.push(`manifest.${k} missing or not ${t}`);
  };
  need("schema", "number"); need("kind", "string"); need("id", "string"); need("name", "string");
  need("description", "string"); need("license", "string"); need("terms", "string"); need("maker", "object"); need("source", "object");
  if (m.kind && !KINDS.includes(m.kind)) errors.push(`kind must be one of ${KINDS.join(", ")}`);
  if (m.id && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(m.id)) errors.push("id must be lowercase letters, digits, dashes");
  if (m.license && !LICENSES.includes(m.license)) errors.push(`license must be one of ${LICENSES.join(", ")}`);
  if (m.terms && m.terms !== "free") errors.push("terms: only \"free\" is listed today (paid listings come with claimed identities)");
  if (m.description && m.description.length > 400) errors.push("description over 400 characters");
  if (m.maker && typeof m.maker.name !== "string") errors.push("maker.name missing");
  return errors;
}
