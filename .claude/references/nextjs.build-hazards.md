# Next.js Build Hazards Reference

Faults that exist only in a **production build** — the bundle Turbopack (Next) or
Rollup/esbuild (the SDK's Vite library build) emits after minification. `next dev`,
`tsx`, and Vitest do not minify, so nothing here reproduces locally by running the
code the normal way. Read this when something "works in dev, fails in prod" and the
symptom is a malformed string, URL, or query rather than an exception.

## 1. Turbopack folds `+`-joined template literals and drops text

**The rule: never join two template literals with `+`. Write one literal, or an array
and `.join(...)`.** Enforced by `src/lib/no-template-concat.test.ts`, which scans
`src/`, `packages/`, `e2e/`, and `scripts/` and fails the run if the pattern comes
back.

### What happened

A sibling repo on the same stack (Next 16 + Turbopack) built an MP `$filter` as three
template literals joined with `+`:

```ts
// ❌ the pattern — do not write this
`Pertains_To_Page_ID=${TEMPLATE_PERTAINS_TO_PAGE_ID} AND ` +
  `Active=1 AND ` +
  `From_Contact=${ENEWS_FROM_CONTACT_ID}`
```

The production minifier folded the chain and dropped the trailing `AND ` of the first
literal **and the entire middle literal**. MP received:

```text
Pertains_To_Page_ID=376From_Contact=142157
```

and answered `Invalid column name 'From_Contact'`, later `Incorrect syntax near
'From_Contact'`. The string was captured live from the deployed function and
reproduced from a local `next build`.

### The trigger, precisely

A `+` chain of **template literals** whose interpolations are **all compile-time
constants** — in that case two numeric module consts. Chains with at least one runtime
value fold correctly, which is why every other concatenation in that repo kept working
and only this one query broke. Plain quoted strings (`"a" + "b"`) were never affected.

That distinction is far too subtle to police in review — a `const` that starts out
runtime-derived and later gets hoisted to a literal silently arms the bug — so the
guard test bans the shape outright rather than the narrow trigger.

### Why it surfaced when it did

It was not a regression. Until an SSO fix made the code path reachable, the actor check
threw before the MP read, so the query had never once executed in production. Both
failures rendered the same generic banner, which made a long-standing fault look like a
fresh one. **A prod-only symptom appearing right after an unrelated auth fix is
evidence the fix unblocked a path, not that it broke one.**

### The diagnostic that would have saved the day

When a prod-only failure looks like a malformed query, URL, or payload, read the
**built** bundle before suspecting the API:

```bash
# Next server chunks
grep -r "Pertains_To_Page_ID" .next/server --include=*.js | head

# The widget bundle
grep -o "Pertains_To_Page_ID[^\"']*" public/embed-sdk/next-embed.*.es.js
```

If the literal in the chunk differs from the literal in the source, the minifier is the
suspect, not MP and not the network.

### Allowed shapes

```ts
// ✅ one literal
const filter = `Group_ID = ${groupId} AND Available_Online = 1 AND End_Date IS NULL`;

// ✅ an array and .join(...) — best when the parts are a list
const filter = [
  `Contacts.Last_Name LIKE '${last}'`,
  `AND Contacts.Email_Address LIKE '${email}'`,
].join(" ");

// ✅ a template literal plus a runtime expression (not literal-to-literal)
const html = `<option value="">—</option>` + options.map(renderOption).join("");

// ✅ plain quoted strings — unaffected by the fold
const base = "Contact_Status_ID != 3" + " AND Contacts.Remove_From_Directory = 0";
```

### Scope in this repo

`src/` is bundled by Turbopack (`next build`) and is where the observed fold happens.
`packages/embed-sdk/` is bundled by Vite/Rollup for `public/embed-sdk/`, a different
minifier with no reproduction on record — but the guard covers it too. The cost of the
rule is nil, the cost of a silently truncated OAuth URL or ICS payload in a widget
running on a customer's site is not.

Upstream: filed against Next/Turbopack with a minimal repro.

## See also

- `src/lib/no-template-concat.test.ts` — the guard, including a scanner that ignores
  comments, quoted strings, and regex literals.
- `.claude/references/ministryplatform.query-syntax.md` — how MP filter strings are
  built, and the error-to-fix map that now carries the folded-chain signature.
- `.claude/TODO/README.md` — deferred toolchain work; read before a dependency bump.
