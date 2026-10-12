# 51. `pnpm audit` is not clean: `braces` ≤3.0.3 (high) has no patched release

**Depends on:** upstream (`braces`, or `@next/eslint-plugin-next` dropping `fast-glob@3`).
**Risk:** low. The path is lint-only and never reaches the server bundle or the SDK.
**Size:** 5 minutes once upstream moves.

Filed 2026-10-11 by the dependency pass. That pass took `pnpm audit` from 17 advisories to
this one.

## The advisory

```
[high] braces <=3.0.3 -> <0.0.0 :: braces vulnerable to stack-exhaustion denial of service
       through deeply nested patterns
    .>eslint-config-next>@next/eslint-plugin-next>fast-glob>micromatch>braces
```

`patched_versions` is `<0.0.0`, which means **no fixed version exists**. `npm view braces
versions` ends at `3.0.3` (verified 2026-10-11). So no override can fix it: there is nothing to
override *to*.

## Why it cannot be fixed in this repo today

- `@next/eslint-plugin-next@16.4.0` pins `fast-glob` to the **exact** version `3.3.1` (verified
  2026-10-11; 16.3.4 did the same). `fast-glob@3` → `micromatch@4` → `braces@3`.
- Forcing `fast-glob` to a different major with an override would mean editing
  `eslint-config-next`'s internals. That is the kind of override the dependency command
  forbids ("never widen a range to make an advisory disappear").
- Exposure: `braces` expands glob patterns that the lint plugin builds from this repo's own
  config. No untrusted input reaches it, and it never runs in `next build` output or in the
  SDK bundle.

## Steps

1. Re-check upstream on each dependency pass:
   - `npm view braces version`. Watch for a release after 3.0.3. If one appears, add an
     in-range override `"braces": ">=<fixed> <4"`.
   - `npm view @next/eslint-plugin-next dependencies`. Watch for `fast-glob` being dropped or
     moved to a release that no longer uses `micromatch@4`.
2. Either of those ends this item. Bump or override, then run `pnpm audit` and confirm 0.

## Done when

`pnpm audit` reports no vulnerabilities.
