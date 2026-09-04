// Decide whether a pull request may merge itself:
//  - every changed listing is an UPDATE to one already on main, signed by
//    the same maker key as before (the maker is updating their own thing), or
//  - the maker's handle is in TRUSTED.json (a first listing from someone we trust).
// Everything else waits for a person. Prints "merge" or "hold: <reason>".
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readProof, proofLocation, normalizeUsername } from "./claim.mjs";

// The fields a claimed listing's own repository is allowed to move: the
// pin and what describes the pinned content. Anything else waits.
const FOLLOW_FIELDS = new Set(["source", "size_chars", "description", "name", "runs_programs", "claimed", "maker"]);

// A claimed listing follows its repository: the proof in the source is the
// signature. An update merges itself when the proof at the new pin still
// names the same username and nothing outside the followed fields changed.
async function repoIsTheMaker(dir, before, m) {
  if (!m.claimed || !before) return false;
  const handle = normalizeUsername(m.maker?.handle);
  if (!handle) return false;
  const prev = normalizeUsername(before.maker?.handle);
  if (prev && prev !== handle) { console.log(`hold: ${dir} changes the claimed username`); process.exit(0); }
  if (before.maker?.agent_pub_key) return false; // key-signed listings keep the key rule
  for (const k of new Set([...Object.keys(before), ...Object.keys(m)])) {
    if (FOLLOW_FIELDS.has(k)) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(m[k])) return false;
  }
  if (m.maker?.agent_pub_key) return false;
  const where = proofLocation(m);
  if (!where) return false;
  let proof = null;
  try { proof = await readProof(where.repo, where.ref, where.path); } catch { return false; }
  return proof === handle;
}

const base = process.env.BASE_SHA;
const trusted = new Set(JSON.parse(readFileSync("TRUSTED.json", "utf8")).handles);
const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" }).split("\n").filter(Boolean);
const dirs = [...new Set(changed.filter((f) => /^(characters|skills|tools)\/[^/]+\//.test(f)).map((f) => f.split("/").slice(0, 2).join("/")))];
const outside = changed.filter((f) => !/^(characters|skills|tools)\/[^/]+\//.test(f));
if (outside.length) { console.log(`hold: changes outside listings (${outside.slice(0, 3).join(", ")})`); process.exit(0); }
if (!dirs.length) { console.log("hold: no listing changed"); process.exit(0); }
for (const dir of dirs) {
  const mp = join(dir, "manifest.json");
  if (!existsSync(mp)) { console.log(`hold: ${dir} removed - a person decides removals`); process.exit(0); }
  const m = JSON.parse(readFileSync(mp, "utf8"));
  const key = m.maker?.agent_pub_key;
  let before = null;
  try { before = JSON.parse(execSync(`git show ${base}:${mp}`, { encoding: "utf8" })); } catch { /* new listing */ }
  if (before) {
    if (await repoIsTheMaker(dir, before, m)) continue; // the maker's repository vouches for this update
    if (!key || before.maker?.agent_pub_key !== key) { console.log(`hold: ${dir} changes the maker key`); process.exit(0); }
    if (!m.signature && m.kind === "skill" && m.source?.kind === "zip") { console.log(`hold: ${dir} unsigned update`); process.exit(0); }
    continue; // an update by the same maker
  }
  if (!m.maker?.handle || !trusted.has(m.maker.handle)) { console.log(`hold: ${dir} is a first listing by ${m.maker?.handle || "unknown"} - a person looks first`); process.exit(0); }
}
console.log("merge");
