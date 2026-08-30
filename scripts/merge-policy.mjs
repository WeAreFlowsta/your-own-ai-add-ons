// Decide whether a pull request may merge itself:
//  - every changed listing is an UPDATE to one already on main, signed by
//    the same maker key as before (the maker is updating their own thing), or
//  - the maker's handle is in TRUSTED.json (a first listing from someone we trust).
// Everything else waits for a person. Prints "merge" or "hold: <reason>".
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

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
    if (!key || before.maker?.agent_pub_key !== key) { console.log(`hold: ${dir} changes the maker key`); process.exit(0); }
    if (!m.signature && m.kind === "skill" && m.source?.kind === "zip") { console.log(`hold: ${dir} unsigned update`); process.exit(0); }
    continue; // an update by the same maker
  }
  if (!m.maker?.handle || !trusted.has(m.maker.handle)) { console.log(`hold: ${dir} is a first listing by ${m.maker?.handle || "unknown"} - a person looks first`); process.exit(0); }
}
console.log("merge");
