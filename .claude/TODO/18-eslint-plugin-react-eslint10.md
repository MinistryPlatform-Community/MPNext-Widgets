# 18. Drop the `settings.react.version` workaround once `eslint-plugin-react` supports ESLint 10

**Depends on:** nothing (introduced by #4, the ESLint 9→10 bump).
**Risk:** none today — lint is green and the resolved rule set is unchanged.
**Size:** ~15 minutes once upstream ships (mostly waiting).

## The problem

`eslint-config-next@16.3.4` pulls three plugins whose published `peerDependencies.eslint`
still stop at 9, so every `pnpm install` now ends with:

```
 WARN  Issues with peer dependencies found
├─┬ eslint-plugin-import 2.32.0
│ └── ✕ unmet peer eslint@"...|| ^9": found 10.10.0
├─┬ eslint-config-next 16.3.4
│ ├─┬ eslint-plugin-import 2.32.0
│ │ └── ✕ unmet peer eslint@"...|| ^9": found 10.10.0
│ ├─┬ eslint-plugin-jsx-a11y 6.10.2
│ │ └── ✕ unmet peer eslint@"...|| ^9": found 10.10.0
│ └─┬ eslint-plugin-react 7.37.5
│   └── ✕ unmet peer eslint@"...|| ^9.7": found 10.10.0
```

Two of the three (`eslint-plugin-import`, `eslint-plugin-jsx-a11y`) are warnings
only — their rules were verified to load and fire correctly under ESLint 10.

`eslint-plugin-react@7.37.5` is the one that genuinely breaks. ESLint 10 removed
the deprecated `context.getFilename()` method, and the plugin's React-version
*detection* path still calls it:

```
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
  at resolveBasedir (eslint-plugin-react/lib/util/version.js:31)
  at detectReactVersion (.../version.js:85)
```

Because `eslint-config-next` sets `settings.react.version = "detect"`, this throws
at **rule-load time** for every linted file, so `pnpm lint` fails outright (exit 2)
rather than reporting findings.

## The workaround currently in `eslint.config.mjs`

The config resolves the installed React version itself and sets it explicitly,
which bypasses `detect` (and therefore the removed API) while doing exactly what
`detect` did:

```js
const reactVersion = require("react/package.json").version;   // "19.2.8"
...
{ settings: { react: { version: reactVersion } } },
```

No rule is disabled or loosened. This was verified: the resolved rule set
(113 rules, 7 plugins) and the linted file set (813 files) are byte-identical to
the ESLint 9 baseline, and rules from all seven plugins were confirmed to fire
against a deliberately-bad probe file.

The one behavioural difference is that the version is now read at config load
rather than lazily per-file — harmless, but it does mean `react` must be
resolvable from the repo root (it always is; it is a direct dependency).

## Steps

1. Check upstream: `npm view eslint-plugin-react version peerDependencies.eslint`.
   As of 2026-09-07 the latest is 7.37.5 with `^3 || ... || ^9.7` — no ESLint 10
   support, and no prerelease either (the `next` dist-tag points at the stale
   `7.8.0-rc.0`). Track https://github.com/jsx-eslint/eslint-plugin-react.
2. Also re-check `eslint-plugin-import` and `eslint-plugin-jsx-a11y`, and whether
   a newer `eslint-config-next` has moved off the unmaintained ones.
3. When `eslint-plugin-react` publishes an ESLint 10-compatible release, delete
   the `settings.react.version` block and the `createRequire` import from
   `eslint.config.mjs` and let `eslint-config-next`'s `"detect"` stand again.
4. Re-run the standard verification gate and re-confirm the file/rule counts
   above (`npx eslint . --format json`, `npx eslint --print-config <a .ts file>`)
   rather than trusting a green exit code.

## This item is now the only thing standing between us and a clean install

Item 17 (better-auth's optional `vitest` peer) was suppressed on 2026-09-08 with a
scoped `pnpm.peerDependencyRules` entry, so these four ESLint warnings are the
**entire** remaining contents of the `Issues with peer dependencies found` banner.
Until this item lands, that banner is still permanent background noise — which was
item 17's stated reason for existing, so the payoff now rides on this item.

Do **not** reach for the same `peerDependencyRules` suppression here as a shortcut.
The better-auth peer was provably inert (one unused file imports `vitest`); this one
is not — `eslint-plugin-react@7.37.5` genuinely breaks under ESLint 10, and the only
reason `pnpm lint` is green is the `settings.react.version` workaround documented
above. Silencing the warning would delete the last visible reminder that the
workaround is load-bearing.

## Done when

`eslint.config.mjs` is back to just the two `eslint-config-next` spreads plus the
`ignores` block, `pnpm lint` is still 0 errors / 0 warnings over 813 files, and
`pnpm install` reports no ESLint-related peer warnings.
