---
description: Run the Pi package preflight checks for this repo
argument-hint: "[package-name]"
---

# Pi Package Check

Run a package preflight for ${1:-the current Pi package work}.

Use the repo conventions in `AGENTS.md` and the `pi-package-authoring` skill.

Checks to run from the repo root:

```bash
npm run typecheck
npm test
npm run format:check
npm run lint:md
npm run pack:artifacts -- --json
```

Then summarize:

- pass/fail for each check,
- package tarball contents,
- any docs links that would break because `docs/` is excluded,
- any dependency placement issues,
- whether the working tree is clean.
