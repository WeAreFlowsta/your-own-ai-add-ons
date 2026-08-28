// AI triage of the listings a pull request adds or changes: builds what a
// reviewer would read, asks the review endpoint (our own model proxy) for
// a verdict against a fixed rubric, comments on the PR, and sets the
// check: clear -> success, look -> success with the `needs-look` label
// (auto-merge stays off), block -> failure. No endpoint (a fork PR has no
// secrets) -> `needs-look`, never a silent pass.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import AdmZip from "adm-zip";

const url = process.env.REVIEW_URL || "";
const secret = process.env.REVIEW_SECRET || "";
const pr = process.env.PR_NUMBER;
const repo = process.env.GITHUB_REPOSITORY;
const base = process.env.BASE_SHA;
const changed = execSync(`git diff --name-only ${base}...HEAD`, { encoding: "utf8" })
  .split("\n")
  .filter((f) => /^(characters|skills)\/[^/]+\/manifest\.json$/.test(f));
const dirs = [...new Set(changed.map((f) => f.split("/").slice(0, 2).join("/")))];
if (!dirs.length) { console.log("no listings changed"); process.exit(0); }

const gh = (args) => execSync(`gh ${args}`, { encoding: "utf8", env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } });
const comment = (body) => gh(`pr comment ${pr} --repo ${repo} --body-file -`, { input: body });
function post(body) {
  execSync(`gh pr comment ${pr} --repo ${repo} --body-file -`, { input: body, encoding: "utf8", env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN } });
}
function label(name, add) {
  try { execSync(`gh pr edit ${pr} --repo ${repo} ${add ? "--add-label" : "--remove-label"} ${name}`, { env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN }, stdio: "ignore" }); } catch { /* label may not exist yet */ }
}

if (!url || !secret) {
  post("**AI review:** not available for this pull request (no review credentials - a fork?). A person will look.");
  label("needs-look", true);
  process.exit(0);
}

let worst = "clear";
const rank = { clear: 0, look: 1, block: 2 };
const lines = [];
for (const dir of dirs) {
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  let content = "";
  if (m.kind === "character") {
    const p = JSON.parse(readFileSync(join(dir, m.file || "pack.json"), "utf8"));
    content = `PERSONA / SYSTEM PROMPT:\n${p.systemPrompt}\n\nASK BLURB: ${p.askBlurb || ""}\n\nSTARTING MEMORIES (${(p.knowledge || []).length}):\n${(p.knowledge || []).map((k) => `- ${k.text}`).join("\n")}`;
  } else if (m.source?.kind === "zip") {
    const zip = new AdmZip(join(dir, m.file || "skill.zip"));
    const entries = zip.getEntries();
    const list = entries.map((e) => `${e.entryName} (${e.header.size} bytes)`).join("\n");
    const skill = entries.find((e) => /(^|\/)SKILL\.md$/.test(e.entryName));
    content = `FILES:\n${list}\n\nSKILL.md:\n${skill ? zip.readAsText(skill).slice(0, 40_000) : "(missing)"}`;
  } else {
    content = `GITHUB SOURCE: ${m.source?.url}\n(pinned commit ${m.source?.commit}; the reviewer sees the manifest only - fetch the SKILL.md at that commit for the full text)`;
    try {
      const raw = `https://raw.githubusercontent.com/${m.source.repo}/${m.source.commit}/${m.source.path ? m.source.path + "/" : ""}SKILL.md`;
      const r = await fetch(raw);
      if (r.ok) content += `\n\nSKILL.md:\n${(await r.text()).slice(0, 40_000)}`;
    } catch { /* manifest-only review */ }
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-review-secret": secret },
    body: JSON.stringify({ kind: m.kind, manifest: { ...m, signature: undefined }, content }),
  });
  if (!res.ok) {
    lines.push(`- \`${dir}\`: reviewer unavailable (${res.status}) - a person will look.`);
    if (rank.look > rank[worst]) worst = "look";
    continue;
  }
  const v = await res.json();
  if (rank[v.verdict] > rank[worst]) worst = v.verdict;
  const mark = v.verdict === "clear" ? "clear" : v.verdict === "look" ? "needs a look" : "BLOCK";
  lines.push(`- \`${dir}\`: **${mark}** - ${v.summary}${v.reasons?.length ? "\n  " + v.reasons.map((r) => `- ${r}`).join("\n  ") : ""}`);
}
post(`**AI review** (triage against the directory rubric; a person still decides):\n\n${lines.join("\n")}\n\n_Verdict: ${worst}_`);
label("needs-look", worst !== "clear");
if (worst === "block") process.exit(1);
