# 19. `@mpnext/embed-sdk` never ships the `.d.ts` its `package.json` advertises

**Depends on:** nothing. Found while doing #3 (the TypeScript 7 attempt) on
2026-09-07, inspecting `packages/embed-sdk/dist/` after a clean `pnpm build:sdk`.
**Risk:** none today — nothing imports the package by name. It is a latent trap.
**Size:** ~20 minutes.

## The problem

`packages/embed-sdk/package.json` promises type declarations:

```json
"types": "./dist/index.d.ts",
"exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/next-embed.es.js" } },
"files": ["dist"]
```

`packages/embed-sdk/tsconfig.json` is set up to produce them —
`"declaration": true`, `"declarationMap": true`, `"outDir": "./dist"` — and the
build script runs tsc first:

```json
"build": "tsc && vite build"
```

But `dist/index.d.ts` does not exist, and never has. After
`rm -rf packages/embed-sdk/dist && pnpm build:sdk`, `dist/` contains exactly four
files:

```
mp-widget-overrides.b3dd7b2a.css
next-embed.2ba8f2b9.es.js
next-embed.2ba8f2b9.es.js.map
next-embed.js
```

No `.d.ts`, no `.d.ts.map`, and none of the per-module `.js` tsc emitted either.

**Cause:** Vite's `build.emptyOutDir` defaults to `true` when `outDir` is inside
the project root, and `packages/embed-sdk/vite.config.ts` does not override it.
So the sequence is: tsc emits declarations + JS into `dist/`, then `vite build`
wipes `dist/` and writes only its own bundle. Everything tsc produced is thrown
away. The `tsc` in the build script is, in effect, a type-check with a
throwaway emit.

Consequences:

- `"types"` and `exports["."].types` point at a file that is never published, so
  any future consumer importing `@mpnext/embed-sdk` gets no types (or a hard
  resolution error under `"moduleResolution": "bundler"` + `exports`).
- `"files": ["dist"]` would publish a package whose declared entry points are
  half missing.
- It is invisible today only because nothing imports the package: the only
  references anywhere are `pnpm --filter @mpnext/embed-sdk …` script invocations
  in the root `package.json` and `playwright.config.ts`. The SDK is consumed by
  browsers over `<script type="module">`, not by TypeScript.

## Options

Pick one; do not do both.

**A — make the promise true (preferred if the package may ever be imported).**
Emit declarations somewhere Vite will not clear, then keep them:

- point tsc at its own directory (`"declarationDir": "./dist/types"` with
  `"emitDeclarationOnly": true`) and update `types` / `exports["."].types` to
  match, **or**
- set `build.emptyOutDir: false` in `vite.config.ts` and clean `dist/` explicitly
  in the build script instead.

Note `hash-sdk.js` and `copy-sdk.js` walk `dist/` — `copy-sdk.js` filters to
`next-embed*` / `mp-widget-overrides*` prefixes, so extra `.d.ts` files there
would be ignored rather than copied into `public/embed-sdk/`. Confirm that still
holds for whichever layout is chosen.

**B — drop the promise (preferred if the package stays browser-only).**
Remove `types` and `exports["."].types` from `package.json`, and change the tsc
invocation to an explicit type-check so the intent is obvious:

```json
"build": "tsc --noEmit && vite build"
```

Also drop `declaration` / `declarationMap` / `outDir` / `rootDir` from
`packages/embed-sdk/tsconfig.json`, since nothing consumes the emit.

Either way, keep the tsc step: it is the SDK's only type gate, and #3 relies on
it running.

## Steps

1. Decide A or B.
2. Apply, then `rm -rf packages/embed-sdk/dist && pnpm build:sdk`.
3. Confirm `dist/` contains what `package.json` claims, and that
   `public/embed-sdk/` still receives exactly `next-embed.<hash>.es.js`,
   its `.map`, `next-embed.js`, and `mp-widget-overrides.<hash>.css`.
4. Confirm the bundle content hash is unchanged from before the edit.
5. Standard verification gate.

## Done when

`packages/embed-sdk/package.json` describes files that actually exist after a
clean `pnpm build:sdk`, and the staged contents of `public/embed-sdk/` are
unchanged.
