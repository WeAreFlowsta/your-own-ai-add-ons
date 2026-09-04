// A claim links a listing to the maker's Flowsta username by a proof that
// only someone with commit rights on the source could have put there:
//   - `flowsta: <username>` in the front matter of the skill's SKILL.md, or
//   - a `.flowsta` file at the repository root holding just the username.
// This module reads that proof from GitHub at a given commit or branch.
// The username is compared lowercase; a leading @ is tolerated.
const GH_RAW = "https://raw.githubusercontent.com";
const PROFILE_API = "https://auth-api.flowsta.com/api/v1/profiles/by-username/";

export function normalizeUsername(u) {
  return String(u || "").trim().replace(/^@/, "").toLowerCase();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "your-own-ai-add-ons" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
}

/** The `flowsta:` value in a SKILL.md front matter, or null. */
export function proofFromFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text || "");
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => /^flowsta\s*:/i.test(l));
  if (!line) return null;
  return normalizeUsername(line.split(":").slice(1).join(":").trim().replace(/^["']|["']$/g, "")) || null;
}

/** The proof at `ref` (a commit sha or branch) of `repo` ("owner/name"),
 *  looking at `<path>/SKILL.md` front matter first, then `.flowsta` at the
 *  root. Returns the username or null. */
export async function readProof(repo, ref, path = "") {
  const p = path ? `${path.replace(/\/$/, "")}/` : "";
  const skill = await fetchText(`${GH_RAW}/${repo}/${ref}/${p}SKILL.md`);
  const fm = proofFromFrontMatter(skill);
  if (fm) return fm;
  const dot = await fetchText(`${GH_RAW}/${repo}/${ref}/.flowsta`);
  return dot ? normalizeUsername(dot.split(/\r?\n/)[0]) || null : null;
}

/** "owner/name" from a GitHub URL, or null. */
export function repoFromUrl(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)/.exec(url || "");
  return m ? `${m[1]}/${m[2].replace(/\.git$/, "")}` : null;
}

/** Does the username resolve to a Flowsta profile? true / false, or null
 *  when the profile service could not be reached (never a hard failure). */
export async function usernameExists(username) {
  try {
    const r = await fetch(PROFILE_API + encodeURIComponent(normalizeUsername(username)), { headers: { "User-Agent": "your-own-ai-add-ons" } });
    if (r.status === 200) return true;
    if (r.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

/** Where a listing's proof lives: the pinned commit for a github skill,
 *  the default branch for a tool (tools are not pinned). */
export function proofLocation(m) {
  if (m.kind === "skill" && m.source?.kind === "github") return { repo: m.source.repo, ref: m.source.commit, path: m.source.path || "" };
  if (m.kind === "mcp") {
    const repo = repoFromUrl(m.source?.url);
    return repo ? { repo, ref: "HEAD", path: "" } : null;
  }
  return null;
}
