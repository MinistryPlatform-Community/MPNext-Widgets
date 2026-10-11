# C34. "Save as PDF" on `next-my-contribution-statement` opens a popup tab instead of downloading the statement

**Widget:** `next-my-contribution-statement` (old: My Contribution Statement)
**Severity:** ux
**Confidence:** confirmed — clicked the button on both widgets with the same two MP statement files and watched what the browser did (download event vs popup page event).
**Found:** 2026-09-08, comparison run

## Old behaviour

`#saveAsPDFButton` (`<input type="button" value="Save as PDF">`) issues
`GET https://mpi.ministryplatform.com/ministryplatformapi/files/<Unique_Name>` and the
browser fires a **download** — Playwright reported
`download.suggestedFilename() === "ZZTEST-Statement-2025.pdf"`, i.e. the file lands in
the user's downloads with the statement's own filename. No tab is opened
(`ctx.waitForEvent("page")` timed out).

## New behaviour

`packages/embed-sdk/src/components/my-contribution-statement.ts:96-107`:

```ts
window.open(statement.Download_Url, "_blank", "noopener");
```

A new page is opened. It targets the same URL (verified: the API payload's
`Download_Url` is byte-identical to what legacy requests, and fetching it returns
`200 application/pdf`, 410 bytes, containing the expected
`ZZTEST 2025 Contribution Statement` marker). So the *file* is right; the delivery is a
tab, not a save, and the label says "Save as PDF".

## Why it matters

`window.open` from a click usually survives a popup blocker, but not always — Safari on
iOS and several mobile in-app browsers (the Facebook and Instagram webviews a church
link gets opened in) either block it or open a tab that cannot render a PDF, and the
donor gets a blank screen with no error and no fallback. Even where it works the
outcome does not match the button: a donor who presses "Save as PDF" during tax season
expects a file, and instead gets a viewer tab they then have to save from. Legacy got
this right, and the fix is one line.

Related and *not* a new-widget defect: the statement URL is an unauthenticated MP file
GUID on both systems — an anonymous request for
`…/ministryplatformapi/files/<guid>` returned `200 application/pdf` with no
credentials at all. Legacy hands out the same URL, so it is MP's design, not ours; it is
recorded here only so nobody mistakes it for something this change introduced.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/my-contribution-statement-new-authed.png`,
  `my-contribution-statement-old-authed.png`
- New: `ctx.on("page")` fired with an empty URL and no `download` event; the API payload
  it opens is
  `{"Download_Url":"https://mpi.ministryplatform.com/ministryplatformapi/files/57625614-a5b0-4588-9053-c1a7e7b74558", "File_Name":"ZZTEST-Statement-2025.pdf", …}`
- Old: `page.on("download")` fired, `suggestedFilename = "ZZTEST-Statement-2025.pdf"`,
  request `GET …/ministryplatformapi/files/57625614-…`
- Anonymous fetch of that URL from a never-authenticated context: `200 application/pdf`, 410 bytes
- Scripts: `.claude/playwright/widget/scripts/giving/stmt-deep2.mjs`, `.claude/playwright/widget/scripts/giving/old-stmt.mjs`

## Where to fix

`packages/embed-sdk/src/components/my-contribution-statement.ts:96-107` (`downloadStatement`)

## Suggested fix

Replace the `window.open` with an anchor click carrying the filename:
create `<a href={Download_Url} download={File_Name} rel="noopener">`, click it, remove
it — same one-gesture behaviour as legacy, no popup involved, and the file gets the
statement's real name instead of a GUID. Keep the `statementDownloaded` event emit as it
is. If the intent was deliberately to preview rather than save, rename the button
("View statement") so the label matches; but legacy's behaviour is the one migrating
churches will expect.

## Resolution — 2026-10-11

**Fixed** (W5, branch `ws/w5-giving`). `downloadStatement()` in
`my-contribution-statement.ts` no longer calls `window.open`.

- **Primary path — a real download.** The statement is fetched (`credentials: "omit"`) as a
  blob and saved through a same-origin `blob:` URL with `<a download="<File_Name>">`, so the
  file lands in Downloads under the statement's own name (`Extension` appended only when
  `File_Name` lacks it). Deviation from the suggested one-liner: a bare
  `<a href={Download_Url} download>` was **not** used, because browsers ignore `download` on a
  cross-origin URL and navigate instead — that would take the donor's own tab away from the
  church's page, worse than the bug. The blob route is what makes `download` honoured.
- **Fallback when MP's file host refuses the cross-origin read (no CORS):** open the
  statement in a new tab (`opener` nulled), i.e. the old behaviour, still the right file.
- **Fallback to the fallback:** that open runs after an `await`, outside the click's user
  gesture, so a popup blocker (iOS Safari, in-app webviews — the case this item names) may
  refuse it. Then the widget renders a status line *"Your browser blocked the statement from
  opening."* with a real **Open the statement** link the donor can press themselves. Nothing
  fails silently.
- The button is disabled while the fetch runs. `statementDownloaded` still fires, now with a
  `method` of `download` / `tab` / `link`.
- Not verified live: whether `mpi.ministryplatform.com/ministryplatformapi/files/<guid>`
  sends CORS headers. If it does not, every customer gets the tab fallback — no worse than
  before — and this should be revisited (e.g. a same-origin proxy route) once checked from a
  real browser. Recorded, not guessed.
- The unauthenticated-file-GUID note above stands; it is MP's design and unchanged.
- Tests (`giving-widgets.test.ts`): blob download with the right name and no tab; the tab
  fallback on a CORS failure; the link when the tab is blocked.
