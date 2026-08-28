// index.json = every manifest, minus the signature bodies, plus raw URLs the
// app and the site read. Committed by the main-branch workflow.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = process.cwd();
const RAW = "https://raw.githubusercontent.com/WeAreFlowsta/your-own-ai-add-ons/main";
const items = [];
for (const kind of ["characters", "skills"]) {
  if (!existsSync(join(root, kind))) continue;
  for (const d of readdirSync(join(root, kind)).sort()) {
    const mp = join(root, kind, d, "manifest.json");
    if (!existsSync(mp)) continue;
    const m = JSON.parse(readFileSync(mp, "utf8"));
    const { signature, ...rest } = m;
    items.push({
      ...rest,
      signed: !!signature,
      dir: `${kind}/${d}`,
      file_url: m.file ? `${RAW}/${kind}/${d}/${m.file}` : null,
      portrait_url: m.portrait ? `${RAW}/${kind}/${d}/${m.portrait}` : null,
      page: `https://yourownai.net/add-ons/${kind}/${d}/`,
    });
  }
}
const index = { schema: 1, generated_at: new Date().toISOString(), count: items.length, items };
writeFileSync(join(root, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`index.json: ${items.length} listing(s)`);
