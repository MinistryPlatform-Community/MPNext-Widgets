# `next-online-directory` — plan

**Items:** C50 (breaking) · C53 (already correct here — reference implementation) ·
C57 (explicitly *not* applicable here)
**Cutover verdict: blocks pilot cutover. No search can run.**
**Owns:** `src/services/onlineDirectoryService.ts`,
`src/lib/providers/ministry-platform/utils/http-client.ts`,
`src/app/api/embed/online-directory/route.ts`

## What the feedback says

**Every search fails.** The widget paints its congregation dropdown and search box, then
answers every query with `GET /tables/Contacts failed: 404 Not Found`. It is not permissions
and not data — it is the **length of the query string**. `selectFields()` returns a 24-column
`$select` (1,337 raw chars) whose last column inlines the whole absolute
`MINISTRY_PLATFORM_BASE_URL` into a SQL expression:

```sql
'https://mpi.ministryplatform.com/ministryplatformapi/files/' + CONVERT(varchar(40), dp_FileUniqueID) AS ContactImageUrl
```

`buildFilter()` adds 552 chars for a three-character keyword, and `http-client.ts:162-164`
encodes with `encodeURIComponent`, spending three characters (`%20`) per space instead of one
(`+`). Total: 2,305 chars for the three-character minimum, against IIS's default
`maxQueryString` of 2048. MP's web server rejects it before ASP.NET sees it and returns an
IIS 404 **HTML page**, which `MPHelper` surfaces as `404 Not Found`.

There is no working path: the widget refuses to search below three characters, and every
query at or above three characters is over the limit. The household chip
(`keyword="hh <id>"`, 2,102 chars) is over too.

**The SQL is valid and the filter is right.** Removing the image column returns 200 with the
correct two rows; the household filter built with `URLSearchParams` returns 200 with the
correct two rows. Only the URL length fails.

## Where the new widget is already better — protect this

Two things, and both are worth stating because a naive fix could undo them.

- **Our privacy model is stricter than legacy's.** We null unlisted phone and address
  *server-side*, never send an email address (only a `canEmail` flag), and never send a birth
  year. Legacy ships all of it to the browser and hides it client-side. Access gates are at
  parity. **This is the widget's best property — do not widen the `$select` to shorten
  anything.**
- **C57 does not apply here.** `formatBirthday()` returning `"Mon D"` with no year is
  *deliberate and correct* in the directory — it is the privacy improvement above. The
  year-dropping fix in C57 belongs only to `next-my-household`, where every record shown is
  the signed-in user's own family. **Do not fix both from that item.**
- It is also the **one auth-only widget with a correct signed-out prompt** (C53) — the
  reference implementation `CROSS-1` lifts into the base class.

## Course of action

Three changes, in descending order of headroom bought. Take the first two; the third is
insurance.

### 1. Compute the image URL in JavaScript, not in SQL (~150 chars, and the right shape anyway)

Select `dp_FileUniqueID` as a plain column and build `contactImageUrl` in `mapMember()` from
`this.imageBaseUrl`, which the service already holds (`onlineDirectoryService.ts:100`). That
removes the `CONVERT`/string-concat expression **and** the whole base URL from the wire.

This is the single most important change for a second reason the item flags: **the overflow
scales with the deployment's base URL length**. A shorter host masks the bug entirely, so a
customer on a short domain could be fine while another 404s — and testing on the wrong domain
would "prove" it fixed.

### 2. Build the query string with `URLSearchParams` (~220 chars)

`http-client.ts:158-166` uses `encodeURIComponent`. `URLSearchParams` encodes a space as `+`,
which MP accepts and which costs one byte instead of three. **Check no other caller depends
on `%20`** before changing a shared client — this file is used by every service.

Together these two take the three-character-keyword case from 2,305 to roughly 1,935: under
the limit with real headroom.

### 3. Shorten the filter itself

The base eligibility clause repeats `Participant_Record_Table_…` three times. Moving it into
an MP-side view or stored procedure is the durable version — it also makes the eligibility
rule reviewable in one place rather than reconstructed from a filter string.

### Not recommended: POST the query

MP's REST API may accept `POST /tables/{table}` with parameters in the body on recent
versions, and the item raises it. It would remove the length ceiling permanently — but it
changes a shared HTTP client's contract for every service to fix one query, and it needs
confirming against the instance first. Hold it as the fallback if 1–3 do not buy enough
headroom on a long-domain customer.

### 4. Pin it with a test — this is the part that matters

```
assert: the built query string for a 3-character keyword is under 2000 characters
```

This class of bug is invisible until a browser hits it, and the failure mode — an HTML 404
from IIS — looks nothing like a query error, which is why nobody read it as a length problem.
A unit test on the built string catches it at the point of edit. Add the household-mode
(`hh <id>`) case too.

## Do better than parity

- **Answer the household-mode question the run could not.** CONFIG-MAP §7.1 asked whether our
  `keyword="hh <id>"` convention matches legacy's `householdid="<id>"`. It was proved correct
  against MP directly, but never through the widget, because the request never reaches MP.
  Once C50 lands, verify it end to end — and consider promoting it to a real
  `household-id` attribute. `keyword="hh 85"` is a magic-string convention that no integrator
  would guess, and the item notes it only reaches parity by that convention.
- **Adopt the shared signed-out helper** from `CROSS-1` rather than keeping this widget's
  bespoke (correct) version, so there is one implementation.
- **Say something useful on overflow.** Even after the fix, a very long keyword on a very long
  domain could theoretically overflow. A guard in the service that refuses to issue a query
  over ~2000 characters and returns a real error beats an IIS HTML page rendered as
  `404 Not Found` at the visitor.

## Acceptance

- `Keh` returns the same two cards legacy returns, with photo, name, household position and
  `m:`/`h:` phones.
- `hh 85` returns the household and paints the family chip.
- The built query string for a three-character keyword is under 2,000 characters, asserted by
  a unit test.
- No email address and no birth year appears in any response payload (regression guard on the
  privacy property).

## Depends on / unblocks

Independent, and it should be early — this widget currently does nothing at all. It **blocks
verification of C53's signed-out path** for this widget, since the signed-in path cannot be
exercised.
