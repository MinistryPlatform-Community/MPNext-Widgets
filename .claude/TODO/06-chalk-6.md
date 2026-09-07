# 6. chalk 5→6

**Depends on:** Node 24 baseline (done).
**Risk:** low. **Size:** ~15 minutes.

## Why

`chalk` 5.6.2 → 6.0.0. `chalk@6` engines: `>=22` — satisfied by the Node 24 baseline.

Dev-only, and the blast radius is small: chalk is used only by the setup scripts,
not by any shipped code. Confirm current usage before bumping:

```
grep -rn "chalk" scripts/ src/ packages/
```

Expected callers: `scripts/setup-bootstrap.mjs` / `scripts/setup.ts`
(the `pnpm setup` and `pnpm setup:check` entry points).

## Note

The original review paired this with `@types/node` 25→26. **That half is now moot** —
`@types/node` was deliberately set to `^24.13.3` in both the root and
`@mpnext/embed-sdk` so the types match the Node 24 runtime we standardized on
(Vercel runs 24). Do **not** bump `@types/node` to 25 or 26; that would put the
types ahead of the runtime again, which is what let Node-25-only APIs typecheck
against a Node 24 deploy target.

## Steps

1. `pnpm update --latest chalk`
2. Exercise the scripts that actually use it: `pnpm setup:check`
3. Standard verification gate.

## Done when

`pnpm setup:check` runs with correct color output and the gate passes.
