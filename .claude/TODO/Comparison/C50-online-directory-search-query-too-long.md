# C50. `next-online-directory` cannot run any search: the MP query string exceeds 2048 chars and MP's IIS answers 404

**Widget:** `next-online-directory` (old: Online Directory — `/widgets/online_directory.aspx`)
**Severity:** breaking
**Confidence:** confirmed — reproduced in the browser and independently against the MP REST API with client credentials, with the byte-length threshold bisected
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-online-directory` searches fine. Typing `Keh` into `#keywordSearchText`
returns **2 cards** (MP Contact_ID 98 and 99, both `Head of Household` in
Household 85), each with photo, name, household position, `m:`/`h:` phones and
the Email / Map / Family actions. Setting `householdid="85"` returns the same
2 records and paints a `Kehayias Family` chip. It posts its query to MP's own
`/Api/OnlineDirectoryApi/SearchOnlineDirectory`, which takes the criteria in a
short request rather than a long `$select`.

## New behaviour

**Every** search fails. The widget shows the warning
`GET /tables/Contacts failed: 404 Not Found`, and
`GET /api/embed/online-directory?keyword=…` returns **500**.

It is not a permission or data problem: it is the length of the query string
`OnlineDirectoryService.search()` builds. `selectFields()` returns a 24-column
`$select` (1,337 raw chars) whose last column embeds the whole absolute
`MINISTRY_PLATFORM_BASE_URL`:

```
'https://mpi.ministryplatform.com/ministryplatformapi/files/' + CONVERT(varchar(40), dp_FileUniqueID) AS ContactImageUrl
```

`buildFilter()` adds a 552-char `$filter` for a 3-char keyword, and
`http-client.ts:162-164` encodes each parameter with **`encodeURIComponent`**,
which spends 3 chars (`%20`) on every space instead of 1 (`+`). The result is
over IIS's default `maxQueryString` of 2048, so MP's web server rejects the
request before ASP.NET sees it and returns an **IIS 404 HTML page**, which
`MPHelper` surfaces as `404 Not Found`.

Measured query-string lengths, exactly as `MPHelper` builds them:

| Search | Encoded query length | Result |
|---|---|---|
| keyword `Keh` (the 3-char minimum) | **2305** | 404 |
| keyword `Kehayias` | **2335** | 404 |
| household mode `hh 85` | **2102** | 404 |
| same `$select`, 23 columns (image column dropped) | 2153 | 404 |
| `$select` alone, encoded | 1557 | — |

There is no working path: the widget refuses to search below
`minimumSearchLength = 3`, and every query at or above 3 chars is over the
limit. The household chip (`keyword="hh <id>"`) is over the limit too, so
CONFIG-MAP §7.1's question — does `keyword="hh 5"` match legacy
`householdid="5"` — cannot be answered from the widget: the household filter is
built correctly (see Evidence) but the request never reaches MP.

## Why it matters

The online directory is completely non-functional on a customer site. The widget
gets past its access check, paints its congregation dropdown and search box, and
then answers every search with a raw `404 Not Found` string. Nothing a church can
configure changes it — the overflow comes from the widget's own `$select`, and a
shorter `MINISTRY_PLATFORM_BASE_URL` only buys about 20 characters against a
250-char excess.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/online-directory-new-search-keh.png` — new, `Keh`, the 404 warning
  - `.claude/playwright/widget/screenshots/online-directory-new-household-85.png` — new, `hh 85`, same 404
  - `.claude/playwright/widget/screenshots/online-directory-old-search-keh.png` — old, `Keh`, 2 cards
  - `.claude/playwright/widget/screenshots/online-directory-old-household-85.png` — old, `householdid=85`, 2 cards + family chip
  - `.claude/playwright/widget/screenshots/online-directory-new-baseline.png` / `-old-baseline.png`
- Network: `GET http://localhost:3000/api/embed/online-directory?keyword=Keh` → **500**;
  `GET http://localhost:3000/api/embed/online-directory?keyword=hh+85` → **500**.
  Widget-visible message: `GET /tables/Contacts failed: 404 Not Found`.
- MP verification (client credentials, same instance). Repeating the service's own
  `$select` / `$filter` / `$orderby` against
  `https://mpi.ministryplatform.com/ministryplatformapi/tables/Contacts`:
  - full 24-column select → **404**, body is IIS's
    `<title>404 - File or directory not found.</title>` page
  - drop the `ContactImageUrl` column → **200, 2 rows**
  - the household-mode filter alone, built with `URLSearchParams` (`+` for spaces,
    1,924 chars) → **200, 2 rows**: Contact 98 `Kehayias, Chris` and Contact 99
    `Kehayias, Sarah`, both Head of Household
  - empty keyword with the base eligibility filter → **200, 12 rows**
  So the SQL is valid and the filter is right; only the URL length fails.

## Where to fix

- `src/services/onlineDirectoryService.ts:229-252` — `selectFields()`, in particular
  the `ContactImageUrl` expression that inlines `this.imageBaseUrl`
- `src/lib/providers/ministry-platform/utils/http-client.ts:158-166` — the
  `encodeURIComponent` query builder
- `src/app/api/embed/online-directory/route.ts` — where the 500 surfaces

## Suggested fix

Stop sending the absolute file URL through SQL: select `dp_FileUniqueID` (or
`Contacts.dp_fileUniqueId`) and build `contactImageUrl` in `mapMember()` from
`this.imageBaseUrl` in JavaScript. That removes ~120 chars of `$select` and the
whole `CONVERT`/string-concat expression, and is the single change that most
reduces length.

That alone may not be enough headroom (2305 − ~150 is still over 2048), so also
consider one of:

- build the query string with `URLSearchParams` in `http-client.ts` so spaces
  cost one byte, saving ~220 chars here (check no other caller depends on `%20`);
- shorten the filter — the base eligibility clause repeats
  `Participant_Record_Table_…` three times and could move into a stored
  procedure or an MP-side view;
- POST the query. MP's REST API accepts long queries via
  `POST /tables/{table}` with the parameters in the body on recent versions —
  worth confirming against the instance before committing to it.

Whichever route is taken, add a regression test that asserts the built query
string for a 3-char keyword stays under 2000 characters — this class of bug is
invisible until a browser hits it, and the failure mode (an HTML 404 from IIS)
looks nothing like a query error.

## Mechanism confirmed in source (main thread, 2026-09-08)

`src/services/onlineDirectoryService.ts:256` inlines an absolute URL into a SQL
expression **inside the `$select` list**:

```sql
'<MINISTRY_PLATFORM_BASE_URL>/files/' + CONVERT(varchar(40), dp_FileUniqueID) AS ContactImageUrl
```

built from `imageBaseUrl` (`:100`). So a single projected column carries a full base URL
through the query string, and `encodeURIComponent` expands every space to `%20`. That is
the described path to 2,100+ chars against IIS's 2048 `maxQueryString`, and it means the
overflow scales with the length of the deployment's base URL — a longer host makes it
worse, so a domain with a shorter URL could mask the bug entirely in testing.

Worth noting for the fix: computing `ContactImageUrl` server-side after the query (the
service already holds `imageBaseUrl`, and `dp_FileUniqueID` is available as a plain
column) removes the largest single contributor to the query string without changing the
response shape.
