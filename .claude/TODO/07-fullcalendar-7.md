# 7. FullCalendar 6→7 (CDN runtime dep)

**Depends on:** nothing.
**Risk:** medium — real API changes, and it renders on customer sites.
**Size:** small diff, but needs visual QA against live MP data.

## Current state

`packages/embed-sdk/src/components/full-calendar.ts:23-31`:

```ts
const FC_VERSION = "6.1.21";
const FC_SRI = "sha384-WDvnzcla8X1CQM97EnYyl4OoTCvmMFp5lBiVNO3IjVdvLMOUjwt+iuYb/Mru5A9v";
const FC_CDN_BASE = `https://cdn.jsdelivr.net/npm/fullcalendar@${FC_VERSION}`;
```

> **Bumping `FC_VERSION` REQUIRES recomputing `FC_SRI`** (added in item 10, done).
> The script tag now carries `integrity` + `crossOrigin="anonymous"`, so a new
> version with the old hash is *blocked by the browser* — `week`/`grid` render
> "Failed to load calendar library." and nothing else fails first, so it is easy
> to misread as a v7 API break. Recompute in the same commit as the bump:
>
> ```
> curl -sL "https://cdn.jsdelivr.net/npm/fullcalendar@7.1.0/index.global.min.js" >   | openssl dgst -sha384 -binary | openssl base64 -A
> ```

Already bumped 6.1.15 → **6.1.21** (latest 6.x) in the dependency pass, and the
new pin is confirmed present in the rebuilt bundle. 6.x is still maintained, so
**there is no urgency here.** Available: `7.1.0` (latest), `7.0.0` (next tag).

## Why it was deferred rather than done

This is not an npm dependency — it is a script fetched at runtime by
`loadScript(...)` from `packages/embed-sdk/src/shared/cdn-loader.ts` and executed
inside the `next-full-calendar` widget on **host church sites**. A regression
ships to production the moment the bundle is deployed, and no test in this repo
renders a real calendar. FullCalendar 7 is a major with genuine API changes to
plugin registration and view configuration.

## Steps

1. Read the FullCalendar 6→7 upgrade guide. Pay attention to how the global/UMD
   bundle exposes itself, since `full-calendar.ts` consumes it off the global
   after `loadScript`. The instance is held as `private calendarInstance: any`,
   so **the compiler will not catch API breakage here** — it is all runtime.
2. Bump `FC_VERSION` to `7.1.0` **and recompute `FC_SRI` in the same edit** (see
   the box above). Check whether the `FC_CDN_BASE`-relative asset
   paths (the JS bundle and any CSS pulled via `injectExternalCSS`) moved in v7 —
   v7 reorganized package layout, so the derived URLs may need updating too.
3. `pnpm build:sdk`, then verify the pinned version **and the new hash** actually
   landed in the output:
   `grep -o "fullcalendar@[0-9.]*\|sha384-[A-Za-z0-9+/=]*" public/embed-sdk/next-embed.*.es.js`
4. **Visual QA** via `pnpm test:widget` (http://localhost:5173,
   `demo-full-calendar.html`) against a live MP domain. Exercise every value of
   `ViewType`: `month`, `grid`, `week`, `list`, `cards`, `calendar` — plus the
   toolbar (`showToolbar`) and the admin branch (`isAdmin`).
5. Re-check date rendering specifically. Per `CLAUDE.md`, MP datetimes are
   wall-clock in the domain time zone and must be formatted with
   `Intl.DateTimeFormat({ timeZone })` from `getMpTimezone()` — **not** parsed as
   local. A calendar library major is exactly where an off-by-one-day regression
   would hide. Test under at least two zones (`TZ=UTC` and a non-UTC zone).

## Done when

All six views render correctly against live MP data, `FC_SRI` matches a freshly
computed hash for the new `FC_VERSION` (and the browser console shows no
"Failed to find a valid digest" error on the `week`/`grid` views), event dates
match MP's wall-clock values under a non-UTC `TZ`, and the standard verification
gate passes.
