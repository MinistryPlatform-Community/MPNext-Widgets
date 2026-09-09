# C01. `next-event-details` returns 500 for a signed-in user's participant list — `api_MPPW_GetInvoice` has no `@MpLoggedInContactId` parameter

**Widget:** `next-event-details` (old: `/widgets/event_details.aspx`, `mpp-event-details`)
**Severity:** breaking
**Confidence:** confirmed — reproduced in the browser and isolated at the MP API layer
**Found:** 2026-09-08, comparison run

## Old behaviour

Signed in as `PLAYWRIGHT_MP_USERNAME` on
`https://mpi.ministryplatform.com/widgets/event_details.aspx/?id=<free registration event>`,
picking self in **Register As** and pressing **Add Another Person** saves the
registration and repaints the widget with a participant list:

> `Participant 1` `Chris Kehayias` `chris.kehayias@acst.com` `321-794-1376`
> `2720 Bradfordt Drive West Melbourne, FL 32904-7322` `Registered`
> … `Your registration is saved pending checkout. This form is reset and ready to
> register an additional person.`

## New behaviour

Same event, same user, `http://localhost:5173/demo-event-details.html?id=<id>` →
**Register & Add Another**:

- `POST /api/embed/event-details/register` → **200** `{"success":true,"guid":"37552732-…"}` — the write lands.
- `GET /api/embed/event-details/participants/37552732-…` → **500**.
- The widget prints `Saved. Add another person below.` and renders **no participant
  list at all** — no name, no "Registered" badge, no edit/remove control, no
  Checkout button.

Signed **out**, the identical flow returns **200** and renders
`Participants / Participant 1 / ZZTEST AnonAgent … / Registered` plus a **Checkout**
button. The break is specific to an authenticated caller.

Root cause: `getEventParticipantsByInvoice()` adds `@MpLoggedInContactId` to the
`api_MPPW_GetInvoice` call whenever a contact id is resolved
(`src/services/eventDetailsService.ts:530-532`). That parameter **does not exist on
this MP instance's procedure**:

```
GET /procs/api_MPPW_GetInvoice?@InvoiceGuid=37552732-…&@MpLoggedInContactId=98
  -> 500 {"Message":"Parameter '@MpLoggedInContactId' does not exists in the requested procedure."}

GET /procs/api_MPPW_GetInvoice?@InvoiceGuid=37552732-…
  -> 200  [[{Invoice_ID:6, …}], [{Event_Participant_ID:5787, Item_Name:"Free Event Registration", …}]]
```

## Why it matters

Every signed-in registrant on a customer site loses the whole post-save half of the
registration flow: they cannot see who they just registered, cannot add a second
person with confidence, cannot correct a mistake, and cannot reach checkout from the
participant panel. The registration row *is* written, so the user is left registered
with no confirmation — the worst of both outcomes. It also breaks the resume path:
returning to the page with `?invoiceid=<guid>` calls the same endpoint, so a
paid/pending invoice can never be re-populated for a signed-in user. Anonymous
visitors are unaffected, which is why this survives a signed-out smoke test.

## Evidence

- Screenshot (new, broken): `.claude/playwright/widget/screenshots/event-details-new-registration-saved.png`
- Screenshot (old, working): `.claude/playwright/widget/screenshots/event-details-old-762-participant-list.png`
- Screenshot (new, signed out, working): `.claude/playwright/widget/screenshots/event-details-new-anon-register-added.png`
- Network: `200 POST /api/embed/event-details/register` then
  `500 GET /api/embed/event-details/participants/37552732-7236-48c7-9aa9-6afeb9111242`
- Console: `Failed to load resource: the server responded with a status of 500 (Internal Server Error)`
- MP verification: the two `api_MPPW_GetInvoice` calls quoted above (client credentials).
- Fixture: `ZZTEST-Free Signup Event` (`Registration_Active = 1`,
  `Online_Registration_Product = 1`, free), created and removed during the run — recreate with
  the recipe in `.claude/playwright/widget/tests/event-details.md`.

## Where to fix

`src/services/eventDetailsService.ts:527-534` (`getEventParticipantsByInvoice`) —
the `@MpLoggedInContactId` parameter. The caller that supplies it is
`src/app/api/embed/event-details/participants/[invoiceGuid]/route.ts:41-49`.

## Suggested fix

Stop sending `@MpLoggedInContactId`: the procedure does not accept it, so no MP
deployment we can reach benefits from it. Call the proc with `@InvoiceGuid` only and
enforce the ownership check in our own code — the header row already returns
`Contact_ID`, so compare it to the resolved `mpContactId` and 403/404 on mismatch.
That is strictly stronger than delegating to a parameter the proc ignores. If the
parameter is believed to exist on some MP versions, probe it once and cache, or gate
it behind an env flag — but do not let its absence 500 the route.

---

**Shared root cause:** see `C80-mploggedincontactid-param-breaks-signed-in-invoice-reads.md`.
This defect and its counterpart (C42, next-checkout) are the same `@MpLoggedInContactId` fault in two
services, found independently by two agents on this run. Fix both call sites together.
