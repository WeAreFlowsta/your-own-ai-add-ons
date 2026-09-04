// Follow claimed listings, and claim listings whose source now names a
// Flowsta username. For every GitHub-sourced skill and every tool whose
// source is a GitHub repository:
//   - read the proof (flowsta: line in SKILL.md front matter, or .flowsta at
//     the root) on the default branch;
//   - an unclaimed listing with a proof whose username resolves to a Flowsta
//     profile becomes claimed under that username;
//   - a claimed skill whose default branch moved past its pin is bumped to
//     the new commit (SKILL.md must still be there, and the proof must still
//     name the same username);
//   - each change is a pull request; verify, the AI review and the merge
//     policy take it from there (the repository is the maker's signature).
// `--dry` prints what would change and opens nothing.
//
// Needs: GH_TOKEN (a token whose PRs trigger workflows - the bot's, not the
// workflow's own GITHUB_TOKEN). Run: node scripts/sync.mjs [--dry]
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readProof, proofLocation, usernameExists, normalizeUsername, repoFromUrl } from "./claim.mjs";

const dry = process.argv.includes("--dry");
const root = process.cwd();
const gh = (args, input) => execSync(`gh ${args}`, { encoding: "utf8", input });
const api = (path) => JSON.parse(execSync(`gh api ${path}`, { encoding: "utf8" }));

function listings() {
  const out = [];
  for (const k of ["skills", "tools"]) {
    if (!existsSync(join(root, k))) continue;
    for (const d of readdirSync(join(root, k))) {
      const mp = join(root, k, d, "manifest.json");
      if (existsSync(mp)) out.push({ dir: `${k}/${d}`, mp, m: JSON.parse(readFileSync(mp, "utf8")) });
    }
  }
  return out;
}

async function plan({ dir, m }) {
  const isSkill = m.kind === "skill" && m.source?.kind === "github";
  const repo = isSkill ? m.source.repo : repoFromUrl(m.source?.url);
  if (!repo) return null;
  if (m.maker?.agent_pub_key) return null; // key-signed listings are the maker's to update
  let head;
  try {
    const r = api(`repos/${repo}`);
    head = api(`repos/${repo}/commits/${r.default_branch}`).sha;
  } catch (e) {
    console.log(`skip ${dir}: ${repo} unreachable (${e.message.split("\n")[0]})`);
    return null;
  }
  const path = isSkill ? m.source.path || "" : "";
  const proof = await readProof(repo, head, path);
  const handle = normalizeUsername(m.maker?.handle);
  const next = JSON.parse(JSON.stringify(m));
  const why = [];

  if (!m.claimed) {
    if (!proof) return null;
    const exists = await usernameExists(proof);
    if (exists === false) { console.log(`hold ${dir}: source names @${proof}, but no Flowsta profile has that username yet`); return null; }
    if (exists === null) { console.log(`skip ${dir}: profile service unreachable`); return null; }
    next.claimed = true;
    next.maker = { ...(m.maker || {}), handle: proof };
    why.push(`claimed by @${proof} - the source names that username`);
  } else if (!proof || proof !== handle) {
    console.log(`hold ${dir}: claimed by @${handle}, but the source now names ${proof ? "@" + proof : "nobody"} - a person decides`);
    return null;
  }

  if (isSkill && head !== m.source.commit) {
    const p = path ? `${path.replace(/\/$/, "")}/` : "";
    let skillMd;
    try { skillMd = api(`repos/${repo}/contents/${p}SKILL.md?ref=${head}`); } catch { skillMd = null; }
    if (!skillMd || skillMd.type !== "file") { console.log(`hold ${dir}: no SKILL.md at ${p} on ${head.slice(0, 7)}`); return null; }
    next.source = { ...m.source, commit: head, url: `https://github.com/${repo}/tree/${head}/${p}`.replace(/\/$/, "") };
    next.size_chars = skillMd.size;
    why.push(`pinned to ${head.slice(0, 7)} (${m.source.commit.slice(0, 7)} before)`);
  }
  if (!why.length) return null;
  return { dir, next, why, head };
}

const changes = [];
for (const l of listings()) {
  const c = await plan(l);
  if (c) changes.push({ ...c, mp: l.mp });
}
if (!changes.length) { console.log("sync: nothing to do"); process.exit(0); }
for (const c of changes) {
  console.log(`${dry ? "would" : "will"} update ${c.dir}: ${c.why.join("; ")}`);
  if (dry) continue;
  const id = c.dir.split("/")[1];
  const branch = `sync/${id}-${c.head.slice(0, 7)}`;
  try { gh(`api repos/{owner}/{repo}/git/ref/heads/${branch} > /dev/null 2>&1`); console.log(`  ${branch} already open - skipped`); continue; } catch { /* new */ }
  execSync(`git checkout -q -B ${branch} origin/main`);
  writeFileSync(c.mp, JSON.stringify(c.next, null, 2) + "\n");
  execSync(`git add ${c.mp} && git -c user.name="add-ons-directory bot" -c user.email="bot@yourownai.net" commit -q -m "${c.dir}: ${c.why.join("; ")}"`);
  execSync(`git push -q -u origin ${branch}`);
  gh(`pr create --base main --head ${branch} --title "${c.dir}: ${c.why[0]}" --body-file -`,
    `Opened by the sync workflow.\n\n- ${c.why.join("\n- ")}\n\nThe proof in the maker's repository (a \`flowsta:\` line or \`.flowsta\` file) is what vouches for this change; verify, the AI review and the merge policy decide the rest.`);
  execSync(`git checkout -q main`);
}
