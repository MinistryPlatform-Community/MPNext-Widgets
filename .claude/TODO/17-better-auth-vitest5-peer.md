# 17. `pnpm install` warns: better-auth's optional `vitest` peer excludes vitest 5

**Status:** **suppressed on 2026-09-08** — the warning is gone; what remains is the
obligation to *delete the suppression* once upstream widens the range.
**Depends on:** nothing (surfaced by #2, which moved us to `vitest@5`).
**Risk:** none functionally — it was a warning, not a failure.
**Size:** ~5 minutes to remove once upstream moves.

## The problem

Since `vitest` went 4.1.7 → 5.0.0 (item 2), a resolution pass ended with:

```
 WARN  Issues with peer dependencies found
.
└─┬ better-auth 1.7.3
  └── ✕ unmet peer vitest@"^2.0.0 || ^3.0.0 || ^4.0.0": found 5.0.0
```

`vitest` is declared **optional** in `better-auth`'s `peerDependenciesMeta`, and it
is only there for `better-auth`'s own test helpers. Verified 2026-09-08: across
`better-auth`'s whole `dist/`, `vitest` is imported by exactly **one** file,
`dist/test-utils/test-instance.mjs`, and nothing in this repo imports it (`grep`
for `better-auth/test`, `better-auth/vitest`, `getTestInstance` → no hits). The
peer is entirely inert here. Nothing was broken: the full suite, `pnpm build` and
`pnpm audit` were all green on vitest 5.

## Upstream has not moved (re-checked 2026-09-08)

- `npm view better-auth dist-tags.latest` → **1.7.3** (unchanged since this item
  was filed; 1.7.3 is still the newest release).
- `npm view better-auth@latest peerDependencies.vitest` → `^2.0.0 || ^3.0.0 || ^4.0.0`.
- Upstream `main` (`raw.githubusercontent.com/better-auth/better-auth/main/packages/better-auth/package.json`)
  also still declares `^2.0.0 || ^3.0.0 || ^4.0.0` — so there is no widened range
  waiting in an unreleased commit either.

So step 2 of the original plan (bump `better-auth`) was not available, and step 3
(deliberate, scoped suppression) is what was done.

## What was done

`package.json`, in the existing `pnpm` block beside `overrides` and
`patchedDependencies`:

```json
"peerDependencyRules": {
  "allowedVersions": {
    "better-auth>vitest": "5"
  }
}
```

Four things about that shape are deliberate:

- **`better-auth>vitest`, not bare `vitest`.** The parent-scoped key silences this
  one edge only. Verified: with the rule in place the four ESLint 10 peer warnings
  (item 18) still print in full, so a genuine conflict elsewhere is still loud.
- **`"5"`, not `">=5"` or `"*"`.** The suppression self-expires: when vitest 6
  lands, the warning returns, which is the prompt to re-check upstream rather than
  a silence that outlives its reason.
- **Not `ignoreMissing`, not a blanket `allowAny`** — either would hide real
  conflicts too.
- **`package.json`, not `pnpm-workspace.yaml`.** Both homes work and silence the
  warning identically, and the YAML one can carry an inline comment, which is why
  it was tried first. It was rejected: pnpm exports `pnpm-workspace.yaml` settings
  to lifecycle scripts as npm config env vars, so with the rule there, this repo's
  `preinstall` hook (`npx -y only-allow pnpm`) prints a new
  `npm warn Unknown env config "peer-dependency-rules"` on **every** install —
  trading one permanent warning line for another. Reproduced twice; the
  `package.json` home emits no such line. JSON cannot hold the explanatory
  comment, which is why the reasoning lives in this file instead.

The lockfile is unaffected: `peerDependencyRules` does not change resolution and
is not recorded in `pnpm-lock.yaml`'s `settings:` block. A `--resolution-only`
pass before and after the change produced a byte-identical lockfile, so this is
safe to land without a lockfile update and CI's `pnpm install --frozen-lockfile`
is unaffected.

## Correction to this item's original premise

It said better-auth→vitest was **the only** peer warning in the tree. That is no
longer true — item 4's ESLint 9→10 bump added four more, all from
`eslint-config-next`'s plugins (item 18):

```
├─┬ eslint-plugin-import 2.32.0
│ └── ✕ unmet peer eslint@"...|| ^9": found 10.10.0
└─┬ eslint-config-next 16.3.4
  ├─┬ eslint-plugin-import 2.32.0 …
  ├─┬ eslint-plugin-jsx-a11y 6.10.2 …
  └─┬ eslint-plugin-react 7.37.5 …
```

So this item alone **cannot** deliver a warning-free install, and the
`Issues with peer dependencies found` banner stays until **item 18** clears. That
was the whole stated reason for fixing this one, so the payoff is deferred to 18 —
this change is now just "one fewer line under the banner, and the better-auth
entry is no longer a red herring when reading it."

## Diagnostic note (cost an initial false negative here)

A plain `pnpm install` on an up-to-date lockfile **skips the resolution step and
prints no peer warnings at all** — it is not evidence the warning is gone. Force a
resolution pass:

```bash
pnpm install --lockfile-only --resolution-only
```

(`--lockfile-only` keeps `node_modules` untouched; pnpm rewrites the lockfile with
LF, so `git checkout -- pnpm-lock.yaml` afterwards to drop the line-ending churn.)

## Steps to retire the suppression

1. Re-check upstream: `npm view better-auth peerDependencies.vitest`. Watch for a
   range including `^5.0.0`.
2. When it widens, bump `better-auth` and delete the `peerDependencyRules` block
   from `package.json`. **The bump — not the deletion — is the risky half:** the
   repo carries `patches/@better-auth__core@1.7.3.patch` (the MP `id_token`
   `clockTolerance: 30` fix, commit e6e7ead), keyed to the exact version
   `@better-auth/core@1.7.3`. Any bump must re-target that patch and re-verify the
   MP OAuth callback still completes, so it belongs in its own branch, not tacked
   onto a dependency sweep. Note the patch is on `@better-auth/core`, not
   `better-auth`, so the two versions move independently.
3. Confirm with the `--resolution-only` command above that no better-auth peer
   warning returns, and that the ESLint ones (or none, if 18 has landed) are all
   that is left.

## Done when

~~`pnpm install` finishes with no peer-dependency warnings~~ — rescoped, since
that is now gated on item 18, not this item:

- **This item:** no `better-auth` peer warning on a resolution pass, and the
  suppression scoped to `better-auth` → `vitest` only. **Met 2026-09-08.**
- **Fully retired when:** `better-auth` ships a widened range, the
  `peerDependencyRules` block is deleted rather than carried forever, and the
  patch above has been re-targeted to whatever version that bump lands on.

## Verification run (2026-09-08)

- `pnpm install --lockfile-only --resolution-only` → better-auth warning gone, the
  four ESLint warnings unchanged, lockfile byte-identical.
- `pnpm install` → clean, no new `npm warn Unknown env config` line.
- `pnpm lint` → 0 errors, 0 warnings.
- `pnpm test:run` → 1129 passed / 15 failed. **The 15 failures are pre-existing
  and unrelated**: all in `packages/embed-sdk/src/components/full-calendar.test.ts`,
  which is unmodified at HEAD while `full-calendar.ts` (+192 lines) and
  `cdn-loader.ts` carry in-flight FullCalendar **7** migration work (item 7) in the
  working tree. A `pnpm` manifest field cannot affect test behaviour.
