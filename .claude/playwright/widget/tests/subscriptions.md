# subscriptions — comparison test log

- **New**: `next-subscriptions` — http://localhost:5173/demo-subscriptions.html
- **Old**: My Subscriptions — https://mpi.ministryplatform.com/widgets/subscriptions.aspx (`<mpp-subscriptions>`)
  **and** Subscribe to Publication — https://mpi.ministryplatform.com/widgets/subscribe_to_publication.aspx (`<mpp-subscribe-to-publication>`)
- **Tested**: 2026-09-08 by subagent PEOPLE (block C50–C59)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME` (`Contacts.Contact_ID` 98)
- **Script**: `…/scratchpad/people-recon-anon.mjs`, `people-authed-new.mjs`, `people-authed-old.mjs`, `profile-subs.mjs`, `restore-flow.mjs`, `anon-login-btn.mjs`, `anon-new.mjs`; MP REST via `mp2.mjs` / `verify1.mjs` / `restore.mjs` / `del2.mjs`

Configuration parity per CONFIG-MAP §2.14: the legacy page sets
`target="./Subscriptions/"`, which is **not** in `mpp-subscriptions`'s
`observedAttributes` — it is dead markup. Its only real option is
`congregationid`, which ours has no equivalent for, client or server side
(already filed as **C61**). `next-subscriptions` accepts no attributes, so no
overrides were needed and the comparison is like-for-like as shipped.

## What I tested

1. **Anonymous render, both sites**, and the anonymous render of
   `subscribe_to_publication.aspx` as well, since that is the second half of the
   pairing.
2. **Signed-in render, both sites.** `assertAuthenticated` after every
   navigation; `waitForWidget(… { apiPattern: /\/api\/embed\/subscriptions/ })`
   on ours. Enumerated every control on both, with checked state.
3. **Data parity against MP.** Read `dp_Publications` and
   `dp_Contact_Publications` with client credentials and matched them to the
   rendered checkboxes.
4. **Subscribe end to end.** Checked the one unchecked publication, watched the
   request, verified the resulting MP row.
5. **Unsubscribe end to end.** Unchecked it again, watched the request, verified
   MP, then deleted the residual row to restore the exact original state.
6. **Anonymous subscribe path.** Checked whether ours has any equivalent of
   `mpp-subscribe-to-publication`'s email-verified, not-signed-in opt-in.
7. **Bulk email opt-out.** Compared where the `Contacts.Bulk_Email_Opt_Out`
   control lives on each side.
8. **Responsive.** 390 x 844 on both sites.

## Results

| # | Check | Old (`mpp-subscriptions`) | New (`next-subscriptions`) | Verdict |
|---|---|---|---|---|
| 1 | Anonymous render | `mppw-alert__warning` "Please login to view your subscriptions." + visible `<input value="Login">` | **"Unable to Load — Authentication required"** + **Try Again** only | **C53** — and ours frames a signed-out state as a *failure* |
| 2 | Renders signed in, no errors | yes | yes — `apiFailures: []`, `consoleErrors: []` | pass |
| 3 | Heading / intro copy | "My Subscriptions" | "My Subscriptions — Choose which publications you'd like to receive." | pass (ours adds a sentence) |
| 4 | Publications listed | 3: Weekly Pastor Newsletter, RSS Feed Example, Weekly Newsletter | same 3, same order | pass |
| 5 | Order | `Online_Sort_Order` 1, 2, 10 | identical | pass |
| 6 | `Available_Online = false` publication excluded | `MailChimp List` (Publication 1) not shown | not shown | pass |
| 7 | Checked state vs MP | Pastor ✓, RSS ✗, Weekly ✓ | Pastor ✓, RSS ✗, Weekly ✓ | pass — matches `dp_Contact_Publications` exactly |
| 8 | Descriptions | collapsed behind a per-publication **Show Description / Hide Description** toggle | shown inline, always | difference, not filed — see below |
| 9 | **Campus filter** | `select#congregationId` (All Records / Not Assigned / …) | none | **already filed as C61** |
| 10 | **Keyword search** | `input#searchText name="keyword"` + a **Search Subscriptions** submit, always visible | hidden below 6 publications (`SEARCH_THRESHOLD = 6`), so absent here | difference, not filed — see below |
| 11 | **"Do not send me bulk email messages"** | `input#BulkEmailOptOut name="bulkemailoptout"`, submitted with the list | **absent** — the control exists only in `next-profile` | **C55** |
| 12 | Save model | batched: **Update Subscriptions** submit button | **per-toggle `PUT`**, no submit button | **new is better** |
| 13 | Subscribe writes to MP | — | check RSS → `PUT /api/embed/subscriptions` **200** → new `dp_Contact_Publications` row (`Contact_Publication_ID` 5, `Publication_ID` 2, `Unsubscribed: false`) | pass |
| 14 | Confirmation feedback | "Thank you for updating your subscriptions!" (one message for the batch) | **"Subscribed to RSS Feed Example"** — names the publication | **new is better** |
| 15 | Unsubscribe writes to MP | — | uncheck RSS → `PUT` **200** → row 5 `Unsubscribed: true`, toast **"Unsubscribed from RSS Feed Example"** | pass |
| 16 | UI reflects MP after the round trip | — | checkboxes `[true, false, true]`, matching MP | pass |
| 17 | Empty-state copy | "No subscriptions found. Please try again with different search criteria." | n/a (no filter to empty) | n/a |
| 18 | **Anonymous subscribe (`subscribe_to_publication.aspx`)** | full anonymous form — **Subcribe As** (Blank Form / each household member), First Name*, Last Name*, Email*, Mobile Phone — for `publicationid="4"` with `verificationEmailTemplateid="157"` | **no counterpart**; `GET /api/embed/subscriptions` returns **401** for `sub === "public"` | **already filed as C70** — confirmed at runtime |
| 19 | One-click unsubscribe (`mpp-unsubscribe`) | legacy tag exists | no counterpart | **already filed as C72** |
| 20 | Forms use the shared validator | n/a | n/a — the widget has no form, only checkboxes; nothing to validate, and no native popup is possible | pass |
| 21 | Responsive 390 x 844 | usable | usable | pass |

## Findings filed

- `C53-auth-required-states-have-no-sign-in-button.md` — signed-out
  `next-subscriptions` shows **"Unable to Load"** and a Try Again button that
  re-runs the same 401 forever, with no way to sign in. Shared with
  `next-profile` and `next-my-household`; this widget has the worst copy of the
  three.
- `C55-subscriptions-no-bulk-email-opt-out.md` — the
  `Contacts.Bulk_Email_Opt_Out` control legacy offered in this widget only exists
  in `next-profile` now.

Confirmed at runtime but **not re-filed** (already covered):
**C61** (no campus filter — verified: no `select` in the shadow root at all),
**C70** (no anonymous subscribe path — verified: the legacy anonymous form
renders fully with no sign-in, ours 401s a public token), **C72** (no one-click
unsubscribe).

## Where the new widget is better

- **Saves on toggle, not on submit.** One `PUT` per checkbox, no
  "Update Subscriptions" button to forget, and a `savingIds` set that prevents a
  double-fire. Legacy loses the whole batch if the submit is missed.
- **Per-publication confirmation.** "Subscribed to RSS Feed Example" /
  "Unsubscribed from RSS Feed Example" names what changed. Legacy's
  "Thank you for updating your subscriptions!" tells you nothing about which
  change landed.
- **Descriptions are visible by default**, so a member can see what a publication
  is before subscribing. Legacy hides every description behind a
  Show Description toggle.
- **Correct round trip on both directions.** The MP rows matched the UI after
  subscribe and after unsubscribe, and the widget re-rendered to match MP rather
  than to its own optimistic state.
- Legacy's shadow root permanently contains "Please login to view your
  subscriptions." even when signed in with data on screen; ours renders one state
  at a time.

## Not tested / blocked

- **Row 8 (description toggle) and row 10 (keyword search) are recorded, not
  filed.** With three publications a collapse toggle and a filter box are both
  pointless, and `SEARCH_THRESHOLD = 6` is a deliberate, defensible choice
  (`subscriptions.ts:12`). Two caveats for whoever revisits this: legacy's
  keyword search is **server-side** (`name="keyword"` goes to MP), whereas ours
  filters the already-fetched array client-side — fine while the list is short,
  but if a church has 50 publications the two behave differently; and legacy
  shows the search **always**, so a church used to it will report it missing.
  Neither is testable properly on this instance, which has only 3
  `Available_Online` publications. Unblocked by creating `ZZTEST-` publications.
- **The empty-state copy** ("No subscriptions found…") could not be reached on
  ours: there is no filter that can empty the list, and all 3 publications are
  online.
- **`mpp-subscribe-to-publication` was rendered but not submitted.** Submitting
  would send a real verification email (template 157) to a real address and
  create a real `dp_Contact_Publications` row for whichever household member the
  "Subcribe As" select names. C70 is already filed off its existence; the runtime
  confirmation I could safely give is that the form renders complete and
  unauthenticated, which is the part that matters for the finding.
- **`mpp-unsubscribe` (C72)** has no sample page; not driven.
- **Legacy writes were not exercised**, so the comparison of *what MP row legacy
  creates* is inferred from the checkbox `name="publications"` / `value="<id>"`
  pairs and from ours writing `dp_Contact_Publications`, not observed. Both read
  the same rows, which is the part that could be verified.

## MP records changed and restored

| Record | Change | How restored | Confirmed |
|---|---|---|---|
| `dp_Contact_Publications` — new row `Contact_Publication_ID` 5 (`Contact_ID` 98, `Publication_ID` 2) | created by the widget's subscribe toggle; then `Unsubscribed: true` by the widget's unsubscribe toggle | `DELETE /tables/dp_Contact_Publications/5` (the `?$ids=5` form returned 200 with an empty body and left the row; the path form removed it) | yes — final read is exactly the two original rows: `{3, Publication 4, Unsubscribed false}` and `{4, Publication 3, Unsubscribed false}` |

`Contacts.Bulk_Email_Opt_Out` was **read only** and left `false`. No publication
was created or modified. No verification email was sent.

## Screenshots

- `screenshots/subscriptions-new-anon.png` — new, signed out: "Unable to Load"
- `screenshots/subscriptions-old-anon.png` — old, signed out: warning + Login
- `screenshots/subscriptions-new-authed.png` — new baseline, signed in
- `screenshots/subscriptions-old-authed.png` — old baseline, signed in (campus select, keyword box, description toggles, bulk-email opt-out, Update Subscriptions)
- `screenshots/subscriptions-new-authed-mobile.png` / `subscriptions-old-authed-mobile.png` — 390 x 844 pair
- `screenshots/subscriptions-new-toggle-on.png` — subscribe: "Subscribed to RSS Feed Example"
- `screenshots/subscriptions-new-toggle-off.png` — unsubscribe: "Unsubscribed from RSS Feed Example"
- `screenshots/subscribe-to-publication-old-anon.png` — the legacy anonymous subscribe form (C70), signed out
- `screenshots/subscribe-to-publication-old-authed.png` — the same form signed in, with the "Subcribe As" household picker
