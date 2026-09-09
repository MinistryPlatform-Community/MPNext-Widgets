# event-details — comparison test log

- **New**: `next-event-details` — http://localhost:5173/demo-event-details.html?id=&lt;eventId&gt;
- **Old**: Event Details — https://mpi.ministryplatform.com/widgets/event_details.aspx
  (markup: `<mpp-event-details returnurl="../Events" checkouturl="https://mpi.ministryplatform.com/Checkout/" opportunityfinderwidgettargeturl="https://mpi.ministryplatform.com/Opportunities/" myhouseholdwidgettargeturl="https://mpi.ministryplatform.com/MyHousehold/" freeeventtemplateid="131" target="../EventSignup/">`)
- **Tested**: 2026-09-08 by subagent `events` (block C01–C09)
- **Auth state(s) tested**: signed out **and** signed in as `PLAYWRIGHT_MP_USERNAME`
  on both sites (`assertAuthenticated` passed on every authed navigation:
  new → `ver=1, sub=03a109d5…, mpToken=true`; old → `authenticated as "Chris Kehayias"`)
- **Scripts**: `…/scratchpad/events/07-ed-old.mjs`, `08-ed-new.mjs`, `09-register.mjs`,
  `10-register-write.mjs`, `11-anon-register.mjs`, `12-old-register.mjs`,
  `16b-mpp-event-registration.mjs`, plus the MP helper `mp.mjs`

> **Correction applied.** The original brief listed this widget as "new only". It is
> not — `mpp-event-details` is a real legacy counterpart (CONFIG-MAP §2.21, §4.4), so
> this log is a head-to-head comparison, not a standalone pass.

## What I tested

1. **Baseline render, both sites, anonymous**, for an ordinary non-registerable event
   (`Event_ID 215`, "Saturday Night Service").
2. **Id addressing.** Legacy accepts the id both as a trailing path segment
   (`/widgets/event_details.aspx/215`) and as a query parameter
   (`/widgets/event_details.aspx/?id=215`) — the legacy Event Finder itself links with
   the query form (`href="./event_details.aspx/?id=215"`). The new widget reads
   `?id=` (name overridable via `id-parameter-name`, default `"id"`) or an explicit
   `event-id` attribute. Verified both legacy forms return the same rendered event.
3. **Control and label inventory** in both shadow roots, recording visibility
   (`offsetParent !== null`) so hidden legacy scaffolding was not mistaken for UI.
4. **Anonymous registration**, both sites, against a registration-active free event.
5. **Signed-in registration**, both sites, same event, including the
   *Register As* household picker and the pre-fill it triggers.
6. **The write actually landing in MP**, by client-credentials query after the submit.
7. **The post-save participant list** on both sites (legacy "Add Another Person",
   new "Register & Add Another").
8. **Validation**: empty required fields and a malformed email, with
   `HTMLFormElement.prototype.reportValidity` and
   `HTMLInputElement.prototype.reportValidity` instrumented to prove the native
   browser popup is never used.
9. **`mpp-event-registration` standalone** (CONFIG-MAP §7 item 5), injected before
   `DOMContentLoaded` so MPWidgets.js sees it during its own scan.
10. **Responsive** at 390×844 on both.

## Results

| # | Check | Old | New | Verdict |
|---|---|---|---|---|
| 1 | Element upgrades, shadow root populated | yes | yes | **pass** |
| 2 | Event 215 anonymous, core fields | `Saturday Night Service` / `Sat, Sep 12, 2026 6:05 PM - 7:30 PM` / `Weekly Saturday Night Church Service` / `Event Contact: ChrisKehayias` / `Location:Main Congregation` | `Saturday Night Service` / `Saturday, September 12, 2026, 6:05 PM – 7:30 PM` / same description / `Contact(s) Kehayias, Chris` / `Location Main Congregation` | **pass** (same data, different formatting) |
| 3 | Id as trailing path segment | works | not supported (query param / attribute) | migration note per CONFIG-MAP §2.21; **not filed** |
| 4 | Id as `?id=` | works | works | **pass** |
| 5 | Back link | `Back to Event Search` | `← Back to events` | cosmetic (C67) |
| 6 | Anonymous, non-registerable event | hidden reg form + hidden `#loginButton` + dead text `Join us! Please login to register.` | nothing but the event + `Add to Calendar ›` | **pass** (legacy text is `display:none`) |
| 7 | Anonymous, registration-active event: visible fields | `firstName, lastName, emailAddress, mobilePhone, addressLine1/2, city, stateRegion, postalCode` | `FirstName, LastName, EmailAddress, MobilePhoneNumber, AddressLine1/2, City, StateRegion, PostalCode` | **pass** — field-for-field |
| 8 | Anonymous, visible buttons | `Add Another Person`, `Register and Checkout` | `Register & Add Another`, `Register & Checkout` | **pass** (wording → C67) |
| 9 | Anonymous submit | — (not exercised on the legacy side) | `200 POST /api/embed/event-details/register` → `{"success":true,"guid":"57c50c5e-…"}` | **pass** |
| 10 | Anonymous participant list after save | — | `200 GET …/participants/57c50c5e-…` → `Participants / Participant 1 / ZZTEST AnonAgent … / Registered` + a `Checkout` button | **pass** |
| 11 | Signed-in *Register As* options | `"" , Blank Form, 98 Kehayias, Christopher (Chris), 99 Sarah, 161 Aiden, 170 Jillian` | `"" , 98 Chris Kehayias, 99 Sarah, 161 Aiden, 170 Jillian, Blank Form` | **pass** — same 4 household members + Blank Form, different order/labels |
| 12 | Signed-in pre-fill on selecting self | fills the form | fills `FirstName=Christopher, LastName=Kehayias, EmailAddress=…, MobilePhoneNumber=321-794-1376, AddressLine1=2720 Bradfordt Drive, City=West Melbourne, StateRegion=FL, PostalCode=32904-7322`, and hidden `HouseholdId=85, CurrentUserContactId=98, ProductId=1, EventId=762` | **pass** |
| 13 | `has-registered` check on selection | shows/hides the warning | `200 GET …/has-registered?eventId=762&contactId=98`; `#ed-already-registered` stays `display:none` | **pass** |
| 14 | Signed-in submit | saves | `200 POST …/register` → `{"success":true,"guid":"37552732-…"}` | **pass** |
| 15 | **Signed-in participant list after save** | `Participant 1 / Chris Kehayias / chris.kehayias@acst.com / 321-794-1376 / 2720 Bradfordt Drive West Melbourne, FL 32904-7322 / Registered` + `Your registration is saved pending checkout…` | **`500 GET …/participants/37552732-…`** — banner says `Saved. Add another person below.` and **no list renders at all** | **FAIL → C01** |
| 16 | Write landed in MP | `Event_Participant_ID 5789` | `Event_Participant_ID 5787`, `Invoice_ID 6` (`Invoice_GUID 37552732-…`, total `0`, status `3`), `Invoice_Detail_ID 10` | **pass** — both wrote real rows |
| 17 | Empty-submit validation | native form behaviour | shared `form-validation.ts`: banner `Please verify the registration details.`, inline `This field is required.` on First/Last/Email, `aria-invalid="true"` on all three | **pass** |
| 18 | Native `reportValidity` popup | n/a | **never called** — both prototypes instrumented, 0 invocations | **pass** |
| 19 | Bad-email validation | native `type=email` | inline `Enter a valid email address.` + `aria-invalid="true"` on `EmailAddress` only | **pass** |
| 20 | Promo-code section | always rendered (`Promo Code` + `Apply`), even for a product with no promos | rendered only when `product.hasPromoCode` | **new is better** |
| 21 | Add-Ons / product option groups | `Add-Ons` heading rendered | product had no option groups, so nothing to render | **not exercised** — see Not tested |
| 22 | Minor-registration fields | `Attendee Information` + `Parent/Guardian Information` present (hidden) | `IsMinorRegistration=false` hidden field; sections conditional | **not exercised** — see Not tested |
| 23 | Anonymous console noise | none beyond MP's standing noise | `401 GET …/basic-contact` **twice** + a needless `POST /api/embed/session` refresh between them, on every anonymous load | **FAIL → C07** |
| 24 | `Add to Calendar` affordance | none | `Add to Calendar ›` link | **new is better** |
| 25 | `mpp-event-registration` standalone | element upgrades, `EventRegistration.js` loads, shadow root created, but **0 characters rendered** and `pageerror: FormFieldBuilder is not defined` | n/a | **internal sub-component — nothing filed** (see below) |
| 26 | Responsive 390×844 | stacks | stacks | **pass** |

## `mpp-event-registration` — settled, nothing filed

Assigned from CONFIG-MAP §7 item 5. Injected the bare tag into
`event_finder.aspx` from a `page.addInitScript` `DOMContentLoaded` listener, which
registers before MPWidgets.js's own scan handler so the loader sees it (CONFIG-MAP §5).
Result:

- MPWidgets.js *did* fetch it — `dist` scripts loaded were `MPWidgets.js`,
  `EventFinder.js`, **`EventRegistration.js`**, `LocaleSelector.js`, `UserLogin.js`.
- `customElements.get("mpp-event-registration")` → `true`; the element has a shadow root.
- The shadow root renders **nothing** (0 characters) and the page throws
  `FormFieldBuilder is not defined`.

So it is an internal sub-component that MP mounts inside `mpp-event-details`, not a
placeable widget: it cannot render outside that host. Its function is already covered
by `next-event-details`'s inline registration form (checks #7–#19 above).
**No item filed**, as instructed.

## Findings filed

- `C01-event-details-participants-500-signed-in.md` — signed-in participant list /
  invoice re-population 500s because `api_MPPW_GetInvoice` has no
  `@MpLoggedInContactId` parameter. Legacy works; anonymous works. **breaking**
- `C07-event-details-anonymous-basic-contact-401-churn.md` — every anonymous load 401s
  on `basic-contact`, triggering a pointless token refresh, a second 401 and two
  console errors. **ux**

## Where the new widget is better

- **Validation is inline and accessible.** Shared `form-validation.ts` puts the message
  next to the field and sets `aria-invalid`, with a summary banner; no native
  `reportValidity` bubble anywhere (instrumented and proven).
- **No dead UI.** The legacy widget ships its entire registration form — minor
  registration, parent/guardian, promo code, add-ons, five submit buttons — into the DOM
  on every load and hides what does not apply, including the permanently-present strings
  `Join us! Please login to register.` and `Warning! You have already registered for
  this Event.` The new widget renders only what applies; the promo section appears only
  when the product actually has promo codes.
- **`Add to Calendar` on the detail page** — no legacy equivalent.
- **Household pre-fill fetches the real address** (`GET /api/embed/household`) rather
  than relying on whatever the registration payload happened to carry.
- **Explicit `Cache-Control: private, no-store`** on the participants/invoice read.

## Not tested / blocked

- **Paid registration, product option groups, add-ons and promo codes.** The only free
  registration product on MPI (`Product_ID 1`, "Free Event Registration") has no option
  groups and no promo codes, and there were **zero** registration-active future events
  before I created one. Exercising the priced path would mean authoring a Product with
  `Product_Option_Groups`, `Product_Option_Prices` and promo rows in MP; that is the
  payments agent's territory (`next-checkout` / `next-pay`, block C40–C49) and the
  checkout hand-off is where it would be observed. `Register & Checkout` was therefore
  not walked to completion — `redirectToCheckout()` was read but not driven.
- **Minor registration** (`Minor_Registration = 1` → attendee + parent/guardian
  sections). No such event exists on MPI and creating one alongside the other fixtures
  was out of scope for this pass.
- **`Registration is full`, `isRegistrationOptionsFull`, external registration URL,
  `forceLogin`.** All three legacy states exist in the new code
  (`event-details.ts:466-500`) but none is reachable without more fixture events.
- **`invoice-id` resume path.** Blocked by C01 for a signed-in user — the endpoint it
  depends on 500s — so it could only be confirmed anonymously (where it works).

## MP fixture data — created and cleaned up

Three `ZZTEST-` events were created with client credentials and **all three deleted**
at the end of the run, along with everything the registrations wrote:

| Table | Rows | Status |
|---|---|---|
| `Events` | 760 `ZZTEST-Multi-Day Retreat`, 761 `ZZTEST-Fall Fest & BBQ, Vol. 1`, 762 `ZZTEST-Free Signup Event` | **deleted** |
| `Event_Participants` | 5787 (new, signed in), 5788 (new, anonymous), 5789 (legacy, signed in) | **deleted** |
| `Invoices` | 6, 7, 8 (all `Invoice_Total = 0`) | **deleted** |
| `Invoice_Detail` | 10, 11, 12 | **deleted** |

**Left behind, deliberately recorded:** the anonymous registration caused MP to create
a new contact — `Contact_ID 942` "AnonAgent, ZZTEST"
(`zztest.anon@example.invalid`, `Household_ID` null) and its `Participant_ID 826`.
Both `DELETE /tables/Participants/826` and `DELETE /tables/Contacts/942` are refused by
the MP API: `Cannot perform operation because the page 'Contacts' is based on a table
that supports direct deletes only.` **These two rows need removing from the MP UI by
someone with Contacts delete rights.** Nothing else remains.

Recipe to recreate the registration fixture (for whoever fixes C01) — `POST /tables/Events`:

```json
{ "Event_Title": "ZZTEST-Free Signup Event", "Event_Type_ID": 7, "Congregation_ID": 1,
  "Program_ID": 1, "Primary_Contact": 98, "Location_ID": 1,
  "Event_Start_Date": "2026-10-24 10:00:00", "Event_End_Date": "2026-10-24 12:00:00",
  "Visibility_Level_ID": 4, "Cancelled": false, "_Approved": true, "_Web_Approved": true,
  "Registration_Active": true, "Online_Registration_Product": 1,
  "Registration_Start": "2026-01-01 00:00:00", "Registration_End": "2026-10-23 23:59:00",
  "Participants_Expected": 50, "Minutes_for_Setup": 0, "Minutes_for_Cleanup": 0 }
```

## Screenshots

- `event-details-old-query.png` — legacy baseline, event 215, `?id=` form, anonymous
- `event-details-old-path.png` — legacy, same event via the trailing path segment
- `event-details-new-215.png` — new baseline, event 215, anonymous
- `event-details-old-mobile.png` / `event-details-new-mobile.png` — both at 390×844
- `event-details-old-reg-762-anon.png` — legacy anonymous registration form
- `event-details-new-reg-762.png` — new anonymous registration form (field-for-field match)
- `event-details-old-762-signedin.png` — legacy signed in, *Register As* picker
- `event-details-old-762-registeras.png` — legacy after selecting self
- `event-details-old-762-participant-list.png` — **legacy participant list after save (C01 contrast)**
- `event-details-new-762-signedin.png` — new signed in, *Register As* picker
- `event-details-new-register-as-prefilled.png` — new, self selected, form pre-filled
- `event-details-new-registration-saved.png` — **new after save: banner, no participant list (C01)**
- `event-details-new-anon-register-added.png` — new, anonymous, participant list renders correctly
- `event-details-new-validation-empty.png` — empty-submit inline errors, no native popup
- `event-details-new-validation-bad-email.png` — `Enter a valid email address.`
- `event-registration-old-standalone.png` — `mpp-event-registration` injected standalone: blank
