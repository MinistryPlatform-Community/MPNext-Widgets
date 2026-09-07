# 17. `pnpm install` warns: better-auth's optional `vitest` peer excludes vitest 5

**Depends on:** nothing (surfaced by #2, which moved us to `vitest@5`).
**Risk:** none functionally — it is a warning, not a failure.
**Size:** ~10 minutes once upstream widens the range (mostly waiting).

## The problem

Since `vitest` went 4.1.7 → 5.0.0 (item 2), every `pnpm install` ends with:

```
 WARN  Issues with peer dependencies found
.
└─┬ better-auth 1.7.3
  └── ✕ unmet peer vitest@"^2.0.0 || ^3.0.0 || ^4.0.0": found 5.0.0
```

`vitest` is declared **optional** in `better-auth`'s `peerDependenciesMeta`, and
it is only there for `better-auth`'s own test helpers, which this repo does not
import. Nothing is broken: the full suite (50 files / 832 tests), `pnpm build`
and `pnpm audit` are all green on vitest 5.

## Why it is worth fixing anyway

It is the **only** peer warning in the tree. As long as it sits there, the
`Issues with peer dependencies found` banner is background noise, and the next
genuine peer conflict — TS 7 (#3) and ESLint 10 (#4) are both peer-sensitive —
will be read as "oh, that warning again" instead of investigated.

## Steps

1. Check whether a newer `better-auth` widens the range:
   `npm view better-auth peerDependencies.vitest` (and the same for the version
   we are on plus the latest). As of 2026-09-07, 1.7.3 is
   `^2.0.0 || ^3.0.0 || ^4.0.0`.
2. If a release includes `^5.0.0`, bump `better-auth` — but note the repo carries
   `patches/@better-auth__core@1.7.3.patch` (the MP `id_token` clock-tolerance
   fix, commit e6e7ead). Any bump must re-target or re-verify that patch, so it
   belongs in its own branch, not tacked onto a dependency sweep.
3. If upstream has not moved, silence it deliberately rather than by accident:
   add `vitest` to `pnpm.peerDependencyRules.allowedVersions` in the root
   `package.json` with a comment pointing at the upstream issue. Do **not** use
   `ignoreMissing` or a blanket `allowAny` — that would hide real conflicts too.

## Done when

`pnpm install` finishes with no peer-dependency warnings, and the suppression (if
that is the route taken) is scoped to `better-auth` → `vitest` only.
