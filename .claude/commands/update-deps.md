# Dependency Update Command

Review every dependency and downstream item in the monorepo, apply the updates that
are safe to apply, and write a per-item TODO file for the ones that need their own
branch.

**This is an apply-and-verify command, not a report command.** The default behavior
is to make changes. Use `--dry-run` if you only want the report.

## Scope — what counts as a "dependency" here

A pass is not complete until all six have been checked. Items 3-6 are the ones that
get skipped, and they are where the real exposure has been:

1. **Root `package.json`** — deps and devDeps.
2. **Every workspace package** — `packages/embed-sdk`, `packages/types`. They declare
   their own `typescript`, `@types/node`, `vite`, `zod`. Use `pnpm outdated -r`; a
   non-recursive check silently ignores them.
3. **`pnpm.overrides`** — treat these as first-class dependencies. See the
   stale-override trap below.
4. **Runtime CDN pins** — third-party scripts the SDK loads at runtime on host sites.
   These are not in the lockfile and `pnpm audit` cannot see them.
   Find them with:
   `grep -rnoE "https://cdn[a-zA-Z0-9./_@-]+" packages/embed-sdk/src`
5. **GitHub Actions** — `.github/workflows/*.yml`.
6. **Node runtime baseline** — `engines.node`, `.nvmrc`, CI `node-version`,
   `@types/node`, and the Vercel runtime. These must agree with each other.

## Instructions

### Phase 0 — Baseline before touching anything

Do this first, always. Without it you cannot tell a failure you caused from one that
was already there.

```bash
node -v && pnpm -v
git status --porcelain          # must be clean; stop and ask if it is not
pnpm test:run                   # record the exact counts, e.g. "48 files / 808 tests"
pnpm lint                       # record error AND warning counts
```

Write the baseline numbers down in your response. Report them again at the end so the
user can diff them.

### Phase 1 — Survey

```bash
pnpm outdated -r
```

Then get the vulnerability list in readable form. **Do not paste raw `pnpm audit`
output** — it renders each advisory as an 8-line box, so 45 advisories is thousands of
unusable lines. Summarize the JSON instead:

```bash
SCRATCH="<the session scratchpad dir from your system prompt>"
pnpm audit --json > "$SCRATCH/audit.json"
node -e "
const fs=require('fs');
const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const rows=Object.values(j.advisories||{}).map(a=>({sev:a.severity,mod:a.module_name,vuln:a.vulnerable_versions,patched:a.patched_versions,title:a.title,paths:[...new Set((a.findings||[]).flatMap(f=>f.paths))].slice(0,3)}));
const order={critical:0,high:1,moderate:2,low:3};
rows.sort((a,b)=>order[a.sev]-order[b.sev]);
for(const r of rows) console.log('['+r.sev+'] '+r.mod+' '+r.vuln+' -> '+r.patched+' :: '+r.title+'\n    '+r.paths.join(' | '));
console.log('TOTAL advisories:',rows.length);
" "$SCRATCH/audit.json"
```

Use the session scratchpad path, **not `/tmp`** — in Git Bash on Windows `/tmp`
resolves to `S:\tmp` and the write fails.

Also survey the non-lockfile items (scope 4-6 above) in the same pass:

```bash
grep -rnoE "https://cdn[a-zA-Z0-9./_@-]+" packages/embed-sdk/src
grep -n "uses:\|node-version" .github/workflows/*.yml
for a in actions/checkout actions/setup-node pnpm/action-setup codecov/codecov-action; do
  echo -n "$a: "; curl -s "https://api.github.com/repos/$a/releases/latest" | grep -o '"tag_name": *"[^"]*"'
done
```

### Phase 2 — Triage into two buckets

**Bucket A — apply now.** Anything that cannot change an API contract:

- Patch and minor bumps within the same major.
- Transitive-only fixes achievable via an in-range override (see technique below).
- Same-major CDN version pin bumps.
- GitHub Action bumps **only after** verifying every input the workflow uses still
  exists in the new major (see below).

**Bucket B — defer to a TODO file.** Anything that needs judgment or manual QA:

- Any major version bump.
- Anything whose verification you cannot do locally (visual QA, live auth flows).
- Anything requiring a code change beyond a version string.
- New lint findings introduced by an upgraded linter config — record them, do not fix
  them in this pass.

Show the user both buckets before applying, unless `--yes` was passed.

### Phase 3 — Apply Bucket A

Batch the routine bumps into one `pnpm update --latest <pkg> <pkg> ...` call rather
than one call per package.

For workspace packages, run it inside the package:
`cd packages/embed-sdk && pnpm update --latest vite`

After each meaningful batch, re-run the gate (Phase 4). If something breaks, fix or
downgrade that one package — do not revert the whole batch.

### Phase 4 — Verification gate

Every one of these must pass before the pass is done:

```bash
pnpm install
npx tsc --noEmit
pnpm --filter @mpnext/embed-sdk exec tsc --noEmit
pnpm --filter @mpnext/types exec tsc --noEmit
pnpm test:run
pnpm lint
pnpm build
pnpm audit
```

Typecheck each workspace package **independently**. A clean root `tsc` does not prove
the SDK compiles, and the SDK build is `tsc && vite build` — it ships through tsc, so
a type regression there reaches the bundle, not just CI.

### Phase 5 — Write TODO files for Bucket B

One file per item in `.claude/TODO/`, numbered, plus a `README.md` index. Follow the
existing files there as the format reference. Each file needs:

- **Depends on / Risk / Size** header line.
- **Why** — including any `pnpm.overrides` entry this upgrade would let us delete.
- **What breaks** — the actual file and line, with the real code quoted.
- **Steps**, **how to test** (name the specific demo page or spec file), **Done when**.
- Any peer/engine constraint you verified, with the date you verified it.

The index must carry an explicit "already done, do not redo" list so the next pass
does not re-litigate this one.

**Write these with the Write tool, not bash heredocs.** Long markdown containing
backticks, apostrophes and code fences reliably breaks shell quoting.

### Phase 6 — Report

- Baseline vs. final test/lint/audit numbers.
- A table of security-driven bumps: package, from → to, what it closed.
- Every judgment call, stated plainly — especially anywhere you did **not** take
  latest, and why.
- The Bucket B list with the TODO filenames.
- Leave the work uncommitted and ask how to split commits.

## The traps — check each one explicitly

These all cost real time to find. Do not rediscover them.

**A stale override can BE the vulnerability.** An exact-version override freezes a
package forever, including past its own CVEs. This repo had
`"minimatch@3>brace-expansion": "1.1.15"` pinning a version with four high
advisories. Cross-check every `pnpm.overrides` entry against the advisory list, and
prefer a range (`">=1.1.18 <2"`) over an exact pin so future patches flow.

**Clear dev-only transitives with in-range overrides instead of majors.** Read the
consumer's declared range first, then override to a patched version inside it:

```bash
node -p "require('./node_modules/jsdom/package.json').dependencies.undici"   # ^7.25.0
# advisory wants >=7.29.0, which is inside ^7.25.0 → safe
```

This cleared 16 advisories (jsdom→undici, eslint→js-yaml, eslint→@humanfs/node)
with zero major bumps. Add a note in the corresponding TODO file to delete the
override once the major lands.

**When `--latest` breaks, drop to the newest version inside the safe major that still
carries the security fix, and pin it with `~`.** `better-auth@1.7.3` removed
`genericOAuthClient` from its client barrel; `1.6.30` still exported it and carried
both required fixes. `~1.6.30` closed the vulnerability with a zero-line code change
and moved the migration to a TODO. Verify the export claim against the actual dist
rather than trusting the changelog:

```bash
grep -rl "theExportName" node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>/dist
```

**Hunt cross-workspace version drift.** Two workspace packages on different minors of
the same library produce dual-instance type errors that read as unrelated bugs — here,
`zod@4.4.3` in `packages/types` against `4.5.4` in the root broke three API routes on
`$ZodError`. Keep shared libs (`zod`, `typescript`, `@types/node`) identical across
every `package.json`.

**`@types/node` must match the deploy runtime, not be latest.** Types ahead of the
runtime let nonexistent APIs typecheck and fail in production. This repo deploys to
Vercel on Node 24, so `@types/node` is deliberately held at `^24.x`. Bumping it is a
regression, not an upgrade.

**Verify a CDN pin landed in the built artifact, not just the source.** `git status`
will not show it — `public/embed-sdk/next-embed.*.js` and `packages/embed-sdk/dist/`
are gitignored. After `pnpm build:sdk`:

```bash
grep -o "fullcalendar@[0-9.]*" public/embed-sdk/next-embed.*.es.js
```

Also flag any **floating** CDN range (`@2` rather than `@2.15.0`) as a supply-chain
finding — it resolves at page load on sites we do not control, outside the lockfile
and outside review.

**Check Action inputs before bumping an Action major.** A clean install proves
nothing; the workflow fails at run time on a renamed input:

```bash
curl -s https://raw.githubusercontent.com/actions/setup-node/v7.0.0/action.yml | grep -A2 "^  [a-z-]*:$"
```

Confirm every input the workflow actually uses still exists. Say plainly in the report
that Action bumps are unverified until the next CI run.

**Expect regenerated-file noise.** A Next major/minor rewrites `next-env.d.ts`; delete
`tsconfig.tsbuildinfo` before a TypeScript bump so you are not reading a stale
incremental cache. Neither is a problem — just do not present them as changes you made.

## Arguments

- `$ARGUMENTS` — all optional:
  - `--dry-run` — survey and triage only; change nothing, write no TODO files.
  - `--security-only` — apply only bumps that close an advisory; skip routine freshening.
  - `--include-majors` — attempt Bucket B inline instead of deferring. One major per
    verification gate, never batched. Expect a long session.
  - `--no-todo` — report Bucket B in chat instead of writing `.claude/TODO/` files.
  - `--yes` — skip the pre-apply confirmation for Bucket A.

## Error Handling

- **Working tree dirty at start** — stop and ask. Do not mix a dependency pass into
  unrelated changes.
- **`engine-strict=true` install failure** — `.npmrc` sets it, so an `engines.node`
  mismatch is a hard install error, not a warning. Report the required vs. actual Node
  version rather than loosening `engines`.
- **A bump breaks typecheck** — identify whether it is a removed API (drop to the safe
  major, pin with `~`, write a TODO) or cross-package drift (align the versions).
  Never suppress with `any` or `@ts-ignore` to get the gate green.
- **Tests fail** — compare against the Phase 0 baseline before assuming you caused it.
- **`pnpm audit` cannot reach clean without a major** — say so explicitly, and put the
  override-removal in the TODO file for that major. Do not quietly leave the audit dirty.

## Notes

- **pnpm, not npm.** `npx -y only-allow pnpm` runs on preinstall and will reject npm.
- Never widen a range to make an advisory disappear. Fix the version.
- The pass may change version pins, override ranges, CDN version constants, and Node
  baseline config. It may **not** refactor project code — that is what the TODO files
  are for.
- Prefer `pnpm outdated -r` over reading `package.json` by eye; it is the only view
  that covers the whole workspace.
- After removing a package, `pnpm prune` clears the stale store entry so
  `ls node_modules/.pnpm/<pkg>@*` stops showing both versions.
- Leave everything uncommitted. Splitting security bumps from routine freshening is a
  reasonable commit boundary to offer.
