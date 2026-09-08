# 28. `@testing-library/jest-dom` matchers are loaded but not typed

**Depends on:** nothing. **Risk:** none today — no test uses a matcher.
**Size:** ~10 minutes.

> Found while writing the item 27 tests on 2026-09-07. **Pre-existing** —
> `src/test-setup.ts` has imported jest-dom since the test stack landed.

## The problem

`src/test-setup.ts` line 1 is `import '@testing-library/jest-dom';`, so the
matchers (`toBeDisabled`, `toBeInTheDocument`, `toHaveAttribute`, …) are
registered at runtime. Their **types** are not: nothing adds
`@testing-library/jest-dom` to `types` in `tsconfig.json`, and no test file
references the package's ambient declarations. The first use fails the gate:

```
src/components/sign-out-button.test.tsx(153,40): error TS2339:
  Property 'toBeDisabled' does not exist on type 'Assertion<void, HTMLElement>'.
```

The test passes under vitest; only `npx tsc --noEmit` rejects it. So the setup
file advertises an API that no test can actually use, and the failure lands on
whoever reaches for the obvious matcher rather than on the file that is wrong.
`sign-out-button.test.tsx` currently works around it with native
`(el as HTMLButtonElement).disabled`.

## Steps

1. Wire the types. Either
   - add `"types": ["@testing-library/jest-dom"]` to `tsconfig.json`
     (careful: an explicit `types` array *replaces* the default "everything in
     `node_modules/@types`" behaviour — list `node` too if anything needs it),
     or
   - add a `src/vitest.d.ts` with
     `import '@testing-library/jest-dom/vitest';` — the package ships a
     vitest-specific entry point that augments vitest's `Assertion`.
   The second is narrower and does not disturb the ambient `@types` resolution.
2. Prove it: change one assertion in `src/components/sign-out-button.test.tsx`
   back to `expect(screen.getByRole('button')).toBeDisabled()` and drop the
   TODO-28 comment above it, then run `npx tsc --noEmit` **and** `pnpm test:run`.
3. If instead the decision is "this app does not use jest-dom", delete the
   import from `src/test-setup.ts` and the dependency, so nothing advertises it.

## Done when

A jest-dom matcher can be used in a test with `npx tsc --noEmit` green (or the
import is gone), and the standard verification gate passes.
