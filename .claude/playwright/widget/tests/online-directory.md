# online-directory — comparison test log

- **New**: `next-online-directory` — http://localhost:5173/demo-online-directory.html
- **Old**: Online Directory — https://mpi.ministryplatform.com/widgets/online_directory.aspx (`<mpp-online-directory>`)
- **Tested**: 2026-09-08 by subagent PEOPLE (block C50–C59)
- **Auth state(s) tested**: signed out, signed in **without** directory access, and signed in **with** directory access (via a recorded-and-restored MP flag change — see MP records changed)
- **Script**: `…/scratchpad/people-recon-anon.mjs`, `people-authed-new.mjs`, `people-authed-old.mjs`, `directory.mjs`, `dir2.mjs`, `dir3.mjs`, `anon-login-btn.mjs`; MP REST via `mplib.mjs` + `mp-check.mjs` / `mp2.mjs` / `dirquery.mjs` / `dirquery2.mjs` / `dirquery3.mjs` / `len.mjs`; flag change + restore via `flag.mjs`

Configuration parity per CONFIG-MAP §2.15: the legacy page sets
`keyword="" hideAddress="true" hideEmail="false" hideBirthdayIcon="false"
hideFamilyLink="false"`, and the demo page sets none of them, so **the Map action
is hidden on the old side and shown on the new**. That difference is a demo-page
artefact, not a defect, and is excluded from everything below. `hide-address`,
`hide-email`, `hide-birthday-icon`, `hide-family-link` and `keyword` all exist on
ours (§4.9), so the pair is configurable like-for-like.

## What I tested

1. **Anonymous render, both sites.**
2. **The access gate, both sites, with the test user's real flags.** Read the
   gate's inputs out of MP with client credentials, then compared what each
   widget renders.
3. **The access gate again with access granted**, so the directory itself could
   be compared at all (the only way on this instance — see below).
4. **Keyword search, both sites.** Typed `Keh` with `pressSequentially` (ours
   listens on `keyup`, so `fill()` does not trigger it). Captured results,
   counts, and every card field.
5. **Household filter, both sites.** Legacy `householdid="85"` vs ours
   `keyword="hh 85"` — the CONFIG-MAP §7.1 question.
6. **Privacy-flag handling.** Read every directory-relevant MP flag for the
   eligible population, re-ran the new service's exact `$select` / `$filter`
   against MP, and disassembled the legacy `OnlineDirectory.js` bundle to see
   what it sends to the browser and what it hides client-side.
7. **Minors.** Checked whether any minor passes either widget's eligibility
   filter.
8. **The 404.** Bisected the failing request by column count and keyword length,
   both through `URLSearchParams` and through the `encodeURIComponent` builder
   the repo actually uses.
9. **Responsive.** 390 x 844 on both sites.

## Results

| # | Check | Old (`mpp-online-directory`) | New (`next-online-directory`) | Verdict |
|---|---|---|---|---|
| 1 | Anonymous render | `mppw-alert__warning` "Please login to view the online directory." + visible `<input value="Login">` | "Please sign in to view the directory." + a real **Sign In** button (`data-action="login"` → `requestLogin()`) | **pass — the only one of my five that gets this right** |
| 2 | Access denied render (test user's real flags) | "You currently are not authorized to view the Directory." | "You do not have access to the directory." | pass — same decision, same wording intent |
| 3 | **Access gate agrees with legacy** | denies, then allows | denies, then allows — identical both ways | **pass** (see the flag table below) |
| 4 | Controls when access is granted | Campus select (`#congregationId`, Any Campus + 2), Keyword search (`#keywordSearchText`), clear `×`, hidden `#householdId` | Congregation select (`#od-congregation`, All Congregations + 2), Keyword search (`#od-keyword`, placeholder "Type at least 3 characters…"), clear `×` | pass |
| 5 | Prompt before searching | "Please enter desired search criteria to see matching results." | "Enter at least 3 characters to search the directory." | pass |
| 6 | **Keyword search `Keh`** | **2 cards** (Contact 98 Head of Household, Contact 99 Head of Household) | **`GET /tables/Contacts failed: 404 Not Found`**, route 500 | **C50 (breaking)** |
| 7 | **Household filter** | `householdid="85"` → the same 2 records + a `Kehayias Family` chip | `keyword="hh 85"` → same 404 | **C50** — the filter is built correctly (proved against MP) but the request never lands |
| 8 | Card fields (source-read, ours; rendered, legacy) | photo, name, position, `m:`/`h:` phones, birthday cake + `.ics`, Email, Map, Family | `renderCard()` emits photo (or a person placeholder), name, position, `m:`/`h:` phones, birthday cake + `.ics`, Email, Map, Family — **same set, in the same order** | parity on paper; **not observable** while C50 stands |
| 9 | Minors excluded | 0 minors in the result set | 0 minors pass the eligibility filter (verified in MP) | pass |
| 10 | Unlisted phone / email / address | returned to the browser and hidden **client-side** | **nulled server-side** before the response is built | **new is better** |
| 11 | Email addresses on the wire | third-party email in the DOM (see below) | never sent — only a `canEmail` boolean | **new is better** |
| 12 | Birth year on the wire | full `dateofBirth` sent to the browser | month/day only (`formatBirthday`) | **new is better** |
| 13 | Result cap / paging | not established (only 2 results available) | `MAX_RESULTS = 100` + "Showing the first results — refine your search" over 20 | untested — see Not tested |
| 14 | Search trigger | `input`/`search` events | **`keyup` only** — a mouse paste or autofill never searches | ux, recorded below, not filed |
| 15 | Responsive 390 x 844 | usable | usable (search shell only, given C50) | pass |

### The access gate, measured

Both widgets gate on the same MP flags, and on this instance the gate is
**closed for everyone by default**:

| Flag | Value for the test contact |
|---|---|
| `Contact_Status` | `Active` |
| `Remove_From_Directory` | `false` |
| `Participant_Record` | 10 |
| `Participant_Type` | `Church Family` — `Can_Access_Directory: true`, `Show_In_Directory: true` |
| `Member_Status_ID` | 1 (`Member`) — `Can_Access_Directory: **false**`, `Show_In_Directory: **false**` |

And **all three** `Member_Statuses` rows on this instance have
`Can_Access_Directory = false` (`Member`, `Faithful Non-Member`,
`Former Member`). `OnlineDirectoryService.canAccessDirectory()` requires
`participantTypeCanAccess && (memberStatusId == null || memberStatusCanAccess)`,
so the only combination that opens the directory is a participant with a
directory-enabled participant type **and no member status**. Legacy's
`/Api/OnlineDirectoryApi/UserCanAccessDirectory` behaves the same way: with
`Member_Status_ID = NULL` it granted access on a **fresh login**.

That last word matters. On my first pass legacy still refused after the flag
change while ours allowed, which looked like a breaking divergence in the access
gate. It was not: MP had cached the permission against the pre-change token. A
clean context with an interactive re-login showed legacy granting access with the
identical flags. **Reported as parity, not as a finding** — and worth recording
as a trap: after changing an MP permission flag, re-login on the legacy side
before believing a denial.

### Privacy: where the data actually goes

This was the highest-risk axis on my assignment, so the finding is stated plainly:
**ours is stricter than legacy on every flag I could measure, and I found nothing
ours exposes that legacy withholds.**

- `OnlineDirectoryService.buildFilter()` requires
  `Contact_Status_ID != 3` (deceased), `Contacts.Remove_From_Directory = 0`,
  `Participant_Type.Show_In_Directory = 1`, and
  `(Member_Status.Show_In_Directory = 1 OR Member_Status_ID IS NULL)`.
  Re-running that exact filter against MP returns **12 eligible contacts** out of
  the instance's population, and **0 minors** (`Household_Position_ID = 3`)
  — verified by a separate count.
- `mapMember()` nulls the value, not just the display:
  `mobilePhone` / `homePhone` are `null` when `*_Unlisted`, `address` is `null`
  when `Home_Address_Unlisted` or there is no `Address_ID`, and the email address
  is **never returned at all** — only `canEmail: !emailUnlisted && !!EmailAddress`.
  Emailing a member goes through `sendEmail()` addressed by contact id, so the
  browser never sees the recipient's address.
- `formatBirthday()` returns `"Mon D"` and `"MM-DD"` — no year, ever.
- Legacy does the opposite. Its `SearchOnlineDirectory` response carries
  `emailAddress`, `emailUnlisted`, `mobilePhoneUnlisted`, `homePhoneUnlisted`,
  `homeAddressUnlisted`, `addressLine1`, `city`, `state`, `postalCode` and
  `dateofBirth` into the browser, and hides them **client-side** in
  `CanShowEmail` / `CanShowMobilePhone` / `CanShowHomePhone`
  (`/widgets/dist/OnlineDirectory.js`). Anyone with dev tools open — or an
  extension, or a saved HAR — can read the unlisted values.
- Concretely: legacy's rendered email modal for a second household member
  contained that member's email address in cleartext in the DOM
  (MP `Contacts.Contact_ID = 99`; the value is deliberately not reproduced here
  or in any TODO item). Ours cannot do that, because it never has the value.
- **Also confirmed**: the test contact's own `Member_Status.Show_In_Directory` is
  `false`, so with his normal flags he is not listed in either directory. Both
  widgets honour that.

## Findings filed

- `C50-online-directory-search-query-too-long.md` — **breaking**: every search
  builds a 2,100–2,335-character MP query string, over IIS's 2048-char
  `maxQueryString`, so MP returns an IIS 404 HTML page and the widget shows
  `GET /tables/Contacts failed: 404 Not Found`. There is no working search path.

Nothing filed on privacy, on the access gate, or on card-field parity —
see above.

**CONFIG-MAP §7.1 (`householdid` vs `keyword="hh <id>"`) — settled as far as it
can be.** The keyword convention is implemented correctly:
`determineSearchType()` routes `"hh 85"` to `householdId`, `buildFilter()` adds
`AND Household_ID_Table.Household_ID = 85`, and `buildOrderBy()` sorts heads of
household first. Running that exact filter against MP returns the **same 2
records in the same order** as legacy `householdid="85"`. So it is parity by a
different route and the cartographer was right to withdraw the draft item — but
it cannot be demonstrated *in the widget* until C50 is fixed, because the
household query is 2,102 chars and 404s too. Re-confirm through the UI after C50.

## Where the new widget is better

- **Unlisted fields are nulled server-side.** This is the substantive one: it
  closes a real leak in the legacy widget, where every unlisted phone, email and
  address in the result set reaches the browser and is only hidden by CSS/JS.
- **Email addresses never reach the browser.** `canEmail` is a boolean and the
  send is addressed by contact id server-side, so a directory user cannot harvest
  addresses. Legacy puts them in the DOM.
- **No birth year is ever sent**, only month and day — enough for the birthday
  `.ics` the card offers, without shipping a date of birth for every member of
  the congregation.
- A genuine **Sign In** button in the signed-out state, wired through
  `requestLogin()` and the cancelable `loginRequired` event — the pattern the
  other four widgets in my set should adopt (C53).
- Labelled controls (`<label>` for both Congregation and the keyword search) and
  a `type="search"` input with a real placeholder.

## Not tested / blocked

- **Everything downstream of a successful search**, because of C50: result
  rendering, card layout, the Email compose panel and its validation, the Map
  link, the birthday `.ics` download, the family chip and its clear button,
  pagination/the 20-result "refine your search" notice, and result scoping by
  congregation. The card *markup* was read from `renderCard()` and matches
  legacy's field set, but that is a source read, not an observation. Unblocked by
  fixing C50 — after which this widget deserves a full re-test, since it is the
  one surface where a field-level difference is a privacy incident.
- **A contact who has individually opted out** (`Remove_From_Directory = 1`) and
  **an unlisted phone/email/address on a listed contact** could not be exercised
  end-to-end in the UI, again because of C50. The filter and the nulling were
  verified directly against MP instead (the queries and counts are above), which
  is stronger evidence than a UI read for the filter but weaker for the render.
- **A minor's record** could not be forced into the result set: no minor passes
  the eligibility filter on this instance (0 of 12 eligible contacts), and I was
  not willing to give a minor's participant record a directory-visible
  participant type to manufacture one.
- **Result cap and paging behaviour** — only 2 records match any name available
  to me and only 12 are eligible instance-wide, so neither `MAX_RESULTS = 100`
  nor the >20 notice could be reached. Unblocked by `ZZTEST-` fixture contacts.
- **Row 14, the `keyup`-only search trigger, is recorded not filed.**
  `attachFormListeners()` binds the debounce to `keyup`
  (`online-directory.ts:264-265`), so a paste by mouse, a browser autofill, or a
  programmatic value change never starts a search — the box just sits there
  showing the "enter at least 3 characters" prompt. It is real, but it is
  invisible behind C50 and would be a one-word fix (`input`) in the same file; I
  left the number for something else. If C50 is fixed without changing it, file it.

## MP records changed and restored

To compare the directory at all I had to open the access gate, because no
`Member_Status` on this instance permits access. I changed **one field on the
test user's own participant record**, recorded the original, tested, and restored
it.

| Record | Field | Original | Test value | Restored | Confirmed |
|---|---|---|---|---|---|
| `Participants` `Participant_ID = 10` (`Contact_ID = 98`, the test user) | `Member_Status_ID` | `1` (`Member`) | `null` | `1` | yes — `GET /tables/Participants?$filter=Participant_ID=10` returned `{"Participant_ID":10,"Contact_ID":98,"Participant_Type_ID":3,"Member_Status_ID":1}` |

No lookup table (`Member_Statuses`, `Participant_Types`) was modified, so no
other person's access changed at any point. No other contact's record was
touched. No directory email was sent.

## Screenshots

Cropped to the viewport (`fullPage: false`) for every shot that could contain
other people's contact details, per the brief.

- `screenshots/online-directory-new-anon.png` — new, signed out: **Sign In** button
- `screenshots/online-directory-old-anon.png` — old, signed out: warning + Login
- `screenshots/online-directory-new-authed.png` — new, access denied (real flags)
- `screenshots/online-directory-old-authed.png` — old, access denied (real flags)
- `screenshots/online-directory-old-msnull-denied.png` — old, mid-investigation, the **stale cached** denial that turned out not to be a divergence
- `screenshots/online-directory-new-baseline.png` / `online-directory-old-baseline.png` — baseline pair with access granted
- `screenshots/online-directory-new-search-keh.png` — **C50**: `Keh` → `404 Not Found`
- `screenshots/online-directory-old-search-keh.png` — old: `Keh` → 2 cards
- `screenshots/online-directory-new-household-85.png` — **C50**: `hh 85` → same 404
- `screenshots/online-directory-old-household-85.png` — old: `householdid=85` → 2 cards + `Kehayias Family` chip
- `screenshots/online-directory-new-mobile.png`, `online-directory-new-household-mobile.png`, `online-directory-old-search-mobile.png` — 390 x 844
- `screenshots/online-directory-new-authed-access.png`, `online-directory-old-authed-access.png`, `online-directory-new-search.png`, `online-directory-new-search-404.png`, `online-directory-new-household-mode.png` — intermediate captures from the same investigation
