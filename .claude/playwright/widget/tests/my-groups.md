# my-groups — comparison test log

- **New**: `next-my-groups` — http://localhost:5173/demo-my-groups.html
- **Old**: My Groups — https://mpi.ministryplatform.com/widgets/my_groups.aspx
- **Tested**: 2026-09-08 by subagent **groups** (block C10–C19)
- **Auth state(s) tested**: signed in as `PLAYWRIGHT_MP_USERNAME` (MP User 98 / Contact 98,
  "Kehayias, Chris") **and** signed out
- **Scripts**:
  - `.claude/playwright/widget/scripts/groups-mg-compare.mjs` — all four states (old authed, old anon, new authed, new anon)
  - `.claude/playwright/widget/scripts/groups-mp-verify4.mts` — resolve the test user, call `api_MPPW_GetMyGroups` directly, enumerate their `Group_Participants`
  - `.claude/playwright/widget/scripts/groups-mp-verify3.mts` — cross-check a second contact's participations

**Configuration used.** The legacy page ships `<mpp-my-groups hidegrouplife="false">`.
`next-my-groups` accepts `hidegrouplife` with the **identical flat-lowercase spelling**
(`my-groups.ts:35-40`) and `false` is already its default, so
`demo-my-groups.html` is like-for-like as served with no injection needed
(CONFIG-MAP.md sections 2.9 and 4.11).

One demo-page detail that matters for the signed-out test: `demo-my-groups.html` wraps the
widget in `<div id="widget-container" style="display:none;">` and shows an
`#auth-placeholder` until the user signs in. The signed-out run therefore un-hid the
container from the test script (`style.display = ""`) so the widget's *own* anonymous
rendering could be observed — that is what a customer embedding `<next-my-groups>` on a
real page gets. No demo page was edited.

## What I tested

1. **Signed-in render, both sides.** `assertAuthenticated` after the navigation, then
   `waitForWidget` (new also gated on `GET /api/embed/my-groups`), full-page screenshots,
   settled shadow text, and a structured read of the card grid: card count, per-card text,
   every `<a href>`, every `<button>`, and the first card's full outer HTML.
2. **Data parity, card by card.** Compared group names, badges, meeting day/time lines,
   start-date lines, descriptions and the Group Connect destination URLs.
3. **Direct API read.** Minted a token through the page's own `AuthSession` and called
   `GET /api/embed/my-groups` to capture the raw JSON behind the render.
4. **MP cross-check, three ways.** (a) Resolved the Playwright user to `User_ID 98` /
   `Contact_ID 98` from `dp_Users`. (b) Called `api_MPPW_GetMyGroups` with `@UserId: 98`
   directly and compared its rows to both widgets. (c) Enumerated *all* of Contact 98's
   `Group_Participants` rows (with the group's `Available_Online`, role title, start and end
   dates) to check for a group either widget was dropping or duplicating.
5. **Leader / member role rendering.** Checked the badge each card carries against
   `IsUserLeader` from the proc and against the participant role titles in MP.
6. **Actions offered.** Enumerated every interactive element in both shadow roots to see
   whether legacy offers an action ours does not (leave group, contact leader, view
   details) or vice versa.
7. **`hidegrouplife` behaviour.** Confirmed the Group Connect / Volunteer Connect button is
   the one thing the attribute governs, and that the URL shape matches.
8. **Signed-out render, both sides**, in a clean unauthenticated browser context.
9. **Responsive.** 390×844 on both signed-in views.
10. **Console / network hygiene** on every run.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, shadow root populated | yes (`mpp-my-groups`) | yes | **pass** |
| 2 | Console errors / failed requests, signed in | none | none (`consoleErrors: []`, `apiFailures: []`) | **pass** |
| 3 | Group count | 2 | 2 | **pass** |
| 4 | Groups listed, in order | Men's Saturday Golf Group, Young Professionals Bible Study | identical, same order | **pass** |
| 5 | Meeting line | `Saturday @ 8:00 AM` / `Tuesday @ 7:00 PM` | identical | **pass** |
| 6 | Start line | `Already Meeting` | `Already Meeting` | **pass** |
| 7 | Description | full text | identical | **pass** |
| 8 | Group image | `…/files/31BBD823-…` | same GUID | **pass** |
| 9 | Badge | `Leader` | `Leader` | **pass** |
| 10 | Group Connect link | `https://mpi.cloudapps.ministryplatform.cloud/connect/group/8` and `/7` | byte-identical, `target="_blank"` **+ `rel="noopener"`** | **pass, new marginally better** |
| 11 | Agreement with `api_MPPW_GetMyGroups @UserId=98` | 2 rows: 8, 7 (`IsUserLeader: 1`, `AvailableOnline: true`) | same 2 | **pass — both correct** |
| 12 | Missing group | none | none | **pass** |
| 13 | Duplicated group | none | none | **pass** |
| 14 | Groups correctly *excluded* | — | — | **pass** — Contact 98 has 6 `Group_Participants` rows; `Babies (Sample)`, `QR SignUp`, `Ushers`, `Catholic Summit`, `QRDreaming` are all `Available_Online = false`, and `James Bible Study` is online but ended `2024-04-01`. Neither widget shows any of them. |
| 15 | Leader vs member role | `Leader` badge from the proc's `IsUserLeader` | same source, same badge | **pass** |
| 16 | Actions offered | Group Connect only | Group Connect only | **pass — no action lost** |
| 17 | Actions legacy had that we lack (leave group / contact leader / view details) | **none** — legacy offers none either | none | **pass** |
| 18 | `hidegrouplife` attribute | `hidegrouplife` | `hidegrouplife` (identical spelling) | **pass** |
| 19 | Volunteer group variant (`Volunteer Connect`) | supported | supported (`volunteerGroup` → `/connect/volunteer/<id>`) | **untested** — see Not tested |
| 20 | Signed-out rendering | `My Groups` + `Please login to view your groups.` + a working **Login** button | `Unable to Load` / `Authentication required. Please sign in.` / a **Try Again** button that re-401s forever, and no sign-in control | **fail → C13** |
| 21 | Signed-out: someone else's data leaked | no | no | **pass** |
| 22 | 390×844 reflow | single column, no horizontal overflow | single column, no horizontal overflow | **pass** |
| 23 | Copy parity (signed in) | `My Groups`, `Leader`, `Group Connect` | identical | **pass** |
| 24 | Empty state copy | `noGroupsFoundMessage` (i18n) | `You are not currently in any groups.` | **untested** — the test user has 2 groups |

Raw new-side payload, for the record (trimmed):

```json
{"groups":[
  {"groupId":8,"groupName":"Men's Saturday Golf Group","meetingDay":"Saturday","meetingTime":"08:00:00",
   "isUserLeader":true,"volunteerGroup":false,"availableOnline":true,"congregationId":1,
   "primaryContactId":98,"location":null},
  {"groupId":7,"groupName":"Young Professionals Bible Study","meetingDay":"Tuesday","meetingTime":"19:00:00",
   "isUserLeader":true,"volunteerGroup":false,"availableOnline":true,"congregationId":1,
   "primaryContactId":98,"location":null}],
 "cloudUrlPrefix":"mpi"}
```

## Findings filed

- `C13-my-groups-signed-out-shows-error-not-signin.md` — signed-out state renders an error card with a dead "Try Again" instead of legacy's sign-in prompt (functional).

No other finding. Signed in, this is the closest pair in the group domain: same data, same
order, same copy, same single action, same link targets.

## Where the new widget is better

- Group Connect links carry `rel="noopener"` alongside `target="_blank"`; legacy's do not.
- The `AvailableOnline` filter is explicit and readable in
  `src/services/myGroupsService.ts` (`getGroups`) rather than buried in a legacy server
  endpoint — and it produces the identical result set.
- Ends-dated participations (`James Bible Study`, ended 2024-04-01) are excluded correctly
  by the proc on both sides; the new service does not second-guess it.

## Not tested / blocked

- **Volunteer Connect (check 19).** No group returned for this user has
  `volunteerGroup: true`, so the `/connect/volunteer/<id>` branch and the
  `Volunteer Connect` label were never rendered. Both code paths were read and are
  equivalent. Unblock by making Contact 98 the primary contact of a `ZZTEST-` group whose
  type is a volunteer type.
- **Empty state (check 24).** The test user has two groups. Unblock by testing with a
  contact who leads none, or by temporarily un-publishing both groups.
- **`hidegrouplife="true"`.** Not exercised — the legacy page sets `"false"`, so `"true"`
  has no like-for-like baseline. The attribute is read on both sides
  (`my-groups.ts:38-40`) and governs only the Connect button.
- **A member-only (non-leader) card.** Every group this user sees is one they lead, so the
  no-badge / member rendering was never shown. `api_MPPW_GetMyGroups` returns groups by
  primary-contact/leadership on this domain, which is why Contact 98's five member-only
  participations do not appear at all — verified identical on both sides, so it is a
  fixture limitation rather than a parity question.

## Fixture data

None created. Nothing left behind.

## Screenshots

- `screenshots/my-groups-old-authed.png` — legacy baseline, signed in, 1440×900.
- `screenshots/my-groups-new-authed.png` — new baseline, signed in, 1440×900.
- `screenshots/my-groups-old-authed-mobile.png` — legacy at 390×844.
- `screenshots/my-groups-new-authed-mobile.png` — new at 390×844.
- `screenshots/my-groups-old-signed-out.png` — legacy: "Please login to view your groups." with a Login button (C13).
- `screenshots/my-groups-new-signed-out.png` — new: "Unable to Load" with a Try Again button and no way to sign in (C13).
