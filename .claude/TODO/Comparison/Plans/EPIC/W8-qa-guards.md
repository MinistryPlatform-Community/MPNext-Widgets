# W8: QA guards & e2e (wave 2, parallel with W7)

**Branch:** `ws/w8-qa`
**Owns:** `e2e/widget/**`, `playwright.config.*` (projects only), and the new guard tests
under `src/lib/` and `packages/embed-sdk/src/`.
**Must not** change component or service code. If a guard fails, report the offending
`file:line` back to the integrator. Do not fix it here.

The README for the comparison says each class of defect survived **because nothing checked
for it**. This workstream adds those checks permanently: the four test gaps from
`Plans/README.md`, plus two guard tests.

## 1. Signed-out spec: `e2e/widget/auth-only-widgets-signed-out.spec.ts` (C81 class)
- Load every auth-only demo page in a never-authenticated context. The list is in
  `W0-foundation.md`; re-measure it from the components that call `renderSignInRequired`.
- Assert all of the following:
  - no `"Unable to Load"` text appears;
  - no `[data-action="retry"]` element is present;
  - in `dual` mode, a `[data-action="login"]` button is present;
  - in `legacy` mode, there is no button and the instructional copy is shown.
- Run it in **both** modes. Use `EMBED_AUTH_MODE_ORIGINS`, or two Playwright projects with
  different env. Check how `login-hardened.spec.ts` detects the mode and reuse that.

## 2. Signed-in invoice/participant coverage (C80 class)
- Add a Playwright spec, gated on `PLAYWRIGHT_MP_USERNAME`/`PASSWORD` like
  `login-hardened.spec.ts`. It signs in, then opens `next-checkout` with a known invoice
  and the event-details participant list. Assert neither returns a 500.
- Skip the spec when creds are absent or the mode is `legacy`.

## 3. Accessibility probe over every demo page (CROSS-3 class)
- `e2e/widget/a11y-probe.spec.ts`. For each `demo-*.html`, walk each widget's shadow root
  and check:
  - every focusable element has an accessible name;
  - no element has `role="link"` without an `href`;
  - after opening any `[role=dialog][aria-modal=true]`, `activeElement` is inside it;
  - the widget renders at least one `h1`–`h6`.
- Use `@axe-core/playwright` only if it is already a dependency. **Do not add new npm
  deps.** Otherwise write a custom probe of about 60 lines.

## 4. Query-shape assertions (C50 / C03 class)
- Add a unit guard that builds every service's MP request with a long base URL and asserts
  the URL is ≤ 2048 characters. Start with `onlineDirectoryService`, then add a
  table-driven list.
- Add a multi-day straddling fixture for `fullCalendarService`. W2 may already have added
  one; extend it rather than duplicate it.

## 5. Guard: a catch that returns an empty result must log (C20 class)
- Add `src/lib/no-silent-empty-catch.test.ts` in the style of
  `no-template-concat.test.ts`. It fails on `catch { return [] }`, `catch {}` followed by
  `return []`, and `catch (e) { return null }` with no `console.`/logger call in the
  block, under `src/services/**`.
- Add an allowlist for intentional cases. Each entry carries a comment explaining why.

## 6. Guard: no phantom-column `$select` (C40 class)
- If W1 has not already done it, extend `mp-column-names.test.ts` to scan `select:` strings
  as well as record keys.

## Acceptance
- All new specs pass on the epic after wave 1.
- Any failure is a real finding and is reported back, not suppressed.
- `pnpm test:e2e:widget` documents its prerequisites at the top of each spec.
