# 33. `next-env.d.ts` flips between `next dev` and `next build`, dirtying the tree

**Depends on:** nothing.
**Risk:** none in prod — a checked-in generated file that changes under you.
It costs a `git checkout -- next-env.d.ts` before every commit, and a
distracted contributor commits the flip instead, which then flips back for the
next person.
**Size:** ~15 minutes (mostly deciding *which* of the two fixes is right).

> Found on 2026-09-07 while browser-testing item 32: `pnpm build` followed by
> `pnpm test:widget` left `next-env.d.ts` modified with no source change of
> mine.

## The problem

`next-env.d.ts` is committed (Next.js generates it and tells you not to edit
it) and Next 16 writes a *different* body depending on which command last ran:

```
# committed / after `next build`
import "./.next/types/routes.d.ts";
import "./.next/types/root-params.d.ts";

# after `next dev`
import "./.next/dev/types/routes.d.ts";
import "./.next/dev/types/root-params.d.ts";
```

So `pnpm dev` (or `pnpm test:widget`) makes a clean tree dirty, and the
standard verification gate — which runs `pnpm build` — quietly writes it back.
Whichever one you ran last is what shows up in `git status`, and it has nothing
to do with the change under review.

## Cause

The dev server and the production build emit their generated route types to
different directories (`.next/dev/types/` vs `.next/types/`), and
`generate-agent-files.js` / the typegen step rewrites the committed reference
file to point at whichever one it just produced.

## Fix sketch

Two candidates — pick one deliberately, do not do both:

1. **Stop tracking it.** Add `next-env.d.ts` to `.gitignore` and `git rm
   --cached` it. Next regenerates it on the first `dev`/`build`, so nothing
   breaks locally, but a *fresh clone that has never run Next* type-checks
   without the route types — confirm `npx tsc --noEmit` on a clean checkout
   (and in CI, which runs `pnpm build` first) still passes before committing
   to this.
2. **Normalise it in CI/pre-commit.** Keep it tracked and add a check that
   fails only on a *real* diff, or a hook that restores it. More moving parts;
   only worth it if (1) turns out to break a cold `tsc`.

Check what Next 16's own docs in `node_modules/next/dist/docs/` say about
tracking this file before choosing — the guidance changed with the `.next/dev`
split.

## Steps

1. Reproduce: `git status` clean → `pnpm build` → clean → `pnpm dev` (kill it
   once ready) → `next-env.d.ts` modified.
2. Read the Next 16 guidance in `node_modules/next/dist/docs/`.
3. Apply option 1, then verify a cold `npx tsc --noEmit` (with `.next` removed)
   and the full gate.
4. If a cold `tsc` needs the file, fall back to option 2.

## Testing

- `rm -rf .next && npx tsc --noEmit` on a tree where `next-env.d.ts` is
  untracked — this is the assertion that decides between the two options.
- Standard verification gate.
- `pnpm build` then `pnpm dev`, and confirm `git status` stays clean across
  both.

## Done when

Running `pnpm dev` and `pnpm build` in either order leaves `git status` clean.
