# Your Own AI add-ons directory

The public list of add-ons for [Your Own AI](https://yourownai.net): **characters**
(complete AIs as signed packs) and **skills** (folders of instructions in the
Agent Skills open standard). The app reads `index.json`; yourownai.net builds
its `/add-ons/` pages from it.

Every listing is one folder with a `manifest.json`:

- `characters/<id>/` - `manifest.json`, `pack.json` (the AI pack, signed by its
  maker's Flowsta identity), `portrait.jpg`
- `skills/<id>/` - `manifest.json` and either a pinned GitHub source
  (`source.kind: github`, full commit) or a signed `skill.zip`

## Adding one

**From the app** - "Share this AI" on an AI, or "Share this skill" on a skill you
added. The app signs it with your Flowsta Vault and opens the pull request for
you; you never need a GitHub account.

**By pull request** - copy an existing folder, fill in the manifest, sign the
file (characters: the pack's signature; skills: an ed25519 signature over the
zip's SHA-256 digest, by your Flowsta identity), open a PR. `npm run verify`
runs the same checks as CI.

What the checks enforce: manifest shape, an allowed license, `terms: free`
(paid listings arrive with claimed identities), the file hash, the signature,
and honesty about programs (`runs_programs`). Listings marked `listed_by:
flowsta` may be unsigned: those are open-source skills we reviewed and pinned;
their makers can claim them with a signature at any time.

A listing is text and data. Installing one never runs anything; the app says so
when a skill ships programs.
