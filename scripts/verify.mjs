// Verify every listing (or the ones given as arguments). Exit 1 on any failure.
// - manifest shape, license, terms, id matches its folder
// - character: pack.json parses, sha256 matches, the pack's signature verifies
//   against its content and matches the maker's key in the manifest
// - skill: a github source is pinned to a 40-char commit; a zip source has
//   the file, sha256 matches, the signature verifies over the digest bytes,
//   SKILL.md is inside; anything that ships programs must say runs_programs
// - mcp (tools/): a recipe - transport + command/args or a local url, needs,
//   an optional fetch (https .git), source.url; runs_programs must be true
// - a listing without a maker signature is allowed only when listed_by is
//   "flowsta" (reviewed open-source listings)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkManifest, packDigest, verifySignature, sha256Hex, MAX_PACK_BYTES, MAX_SKILL_ZIP_BYTES } from "./lib.mjs";

const root = process.cwd();
const targets = process.argv.slice(2);
const dirs = targets.length
  ? targets
  : ["characters", "skills", "tools"].flatMap((k) => (existsSync(join(root, k)) ? readdirSync(join(root, k)).map((d) => join(k, d)) : []));

let failures = 0;
const fail = (dir, msg) => { failures++; console.log(`FAIL ${dir}: ${msg}`); };

for (const dir of dirs) {
  const full = join(root, dir);
  if (!statSync(full).isDirectory()) continue;
  const mp = join(full, "manifest.json");
  if (!existsSync(mp)) { fail(dir, "no manifest.json"); continue; }
  let m;
  try { m = JSON.parse(readFileSync(mp, "utf8")); } catch (e) { fail(dir, `manifest.json: ${e.message}`); continue; }
  for (const e of checkManifest(m)) fail(dir, e);
  const folder = dir.split("/").pop();
  if (m.id !== folder) fail(dir, `id "${m.id}" does not match folder "${folder}"`);
  if (dir.startsWith("characters") && m.kind !== "character") fail(dir, "kind must be character here");
  if (dir.startsWith("skills") && m.kind !== "skill") fail(dir, "kind must be skill here");
  if (dir.startsWith("tools") && m.kind !== "mcp") fail(dir, "kind must be mcp here");

  if (m.kind === "character") {
    const pp = join(full, m.file || "pack.json");
    if (!existsSync(pp)) { fail(dir, "pack file missing"); continue; }
    const raw = readFileSync(pp);
    if (raw.length > MAX_PACK_BYTES) fail(dir, `pack over ${MAX_PACK_BYTES} bytes`);
    if (m.sha256 && sha256Hex(raw) !== m.sha256) fail(dir, "pack sha256 does not match manifest");
    let pack;
    try { pack = JSON.parse(raw.toString("utf8")); } catch (e) { fail(dir, `pack: ${e.message}`); continue; }
    if (pack.format !== "your-own-ai/ai-pack") fail(dir, "pack format is not your-own-ai/ai-pack");
    if (!pack.signature) { if (m.listed_by !== "flowsta") fail(dir, "unsigned pack (only Flowsta-reviewed listings may be unsigned)"); }
    else {
      if (!verifySignature(pack.signature, packDigest(pack))) fail(dir, "pack signature does not verify");
      if (m.maker?.agent_pub_key && m.maker.agent_pub_key !== pack.signature.agent_pub_key) fail(dir, "maker key differs from the pack's signing key");
    }
    if (m.portrait && !existsSync(join(full, m.portrait))) fail(dir, "portrait file missing");
  }

  if (m.kind === "skill") {
    const src = m.source || {};
    if (src.kind === "github") {
      if (!/^[^/]+\/[^/]+$/.test(src.repo || "")) fail(dir, "source.repo must be owner/repo");
      if (!/^[0-9a-f]{40}$/.test(src.commit || "")) fail(dir, "source.commit must be a full 40-char commit");
      if (m.listed_by !== "flowsta" && !m.claimed && !m.signature) fail(dir, "a github listing needs a maker signature or a Flowsta review");
    } else if (src.kind === "zip") {
      const zp = join(full, m.file || "skill.zip");
      if (!existsSync(zp)) { fail(dir, "zip missing"); continue; }
      const raw = readFileSync(zp);
      if (raw.length > MAX_SKILL_ZIP_BYTES) fail(dir, "zip over 50 MB");
      const hex = sha256Hex(raw);
      if (m.sha256 !== hex) fail(dir, "zip sha256 does not match manifest");
      if (!m.signature) fail(dir, "a zip listing must be signed by its maker");
      else if (!verifySignature(m.signature, Buffer.from(hex, "hex"))) fail(dir, "zip signature does not verify");
      const listing = raw.toString("latin1");
      if (!/SKILL\.md/.test(listing)) fail(dir, "zip has no SKILL.md");
      const programs = /\.(sh|py|js|ts|mjs|ps1|bat|cmd|exe|rb)(\x00|PK|$)/.test(listing) || /(^|\/)(scripts|hooks|bin)\//.test(listing) || /\.mcp\.json|hooks\.json/.test(listing);
      if (programs && !m.runs_programs) fail(dir, "zip ships programs but runs_programs is not true");
    } else fail(dir, "source.kind must be github or zip");
  }
  if (m.kind === "mcp") {
    // A tool listing is a recipe, not a file: how to start an MCP server,
    // what it needs, and where its source lives. Nothing is fetched at
    // listing time; the app fetches only behind a button that says so.
    const r = m.mcp || {};
    if (r.transport === "stdio") {
      if (typeof r.command !== "string" || !r.command.trim()) fail(dir, "mcp.command missing");
      if (!Array.isArray(r.args) || r.args.some((a) => typeof a !== "string")) fail(dir, "mcp.args must be an array of strings");
    } else if (r.transport === "http") {
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(r.url || "")) fail(dir, "mcp.url must be a local address (127.0.0.1 or localhost)");
    } else fail(dir, "mcp.transport must be stdio or http");
    for (const n of r.needs || []) {
      if (typeof n.program !== "string" || typeof n.label !== "string" || !/^https:\/\//.test(n.install || "")) fail(dir, "mcp.needs entries need program, label, install (https)");
    }
    if (r.fetch) {
      if (!/^https:\/\/[^\s]+\.git$/.test(r.fetch.url || "")) fail(dir, "mcp.fetch.url must be an https .git URL");
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(r.fetch.dest || "")) fail(dir, "mcp.fetch.dest must be a plain folder name");
    }
    const src = m.source || {};
    if (!/^https:\/\//.test(src.url || "")) fail(dir, "source.url (the server's home or repository) must be https");
    if (m.listed_by !== "flowsta" && !m.claimed && !m.signature) fail(dir, "a tool listing needs a maker signature or a Flowsta review");
    if (m.runs_programs !== true) fail(dir, "a tool runs programs by definition - runs_programs must be true");
  }
  if (!failures) console.log(`ok   ${dir}`);
}
console.log(failures ? `\n${failures} failure(s)` : `\nall ${dirs.length} listing(s) verified`);
process.exit(failures ? 1 : 0);
