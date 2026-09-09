# `next-profile` — plan

**Items:** C51 (breaking — silent data loss) · C53 (functional, shared) ·
C55 (cross-reference — the bulk-email opt-out lives here)
**Cutover verdict: blocks pilot cutover. It deletes real contact data on a 200.**
**Owns:** `packages/embed-sdk/src/components/profile.ts`, `src/services/profileService.ts`,
`src/app/api/embed/profile/route.ts`

## What the feedback says

Type any non-numeric text into Mobile Phone or Work Phone, press Save Profile, and the stored
number is **deleted from MP** with a success toast and no validation message. Verified against
the live contact: `Contacts.Mobile_Phone` went `321-794-1376` → `null` on a `200`.

The ordering is what makes it silent, and it is the part the fix has to change:

1. `formatPhone()` runs on **every `input` event** and does `input.value.replace(/\D/g, "")`.
   For `ZZTEST-abc` the digit set is empty, so the live field is rewritten to `""` **while the
   user types** (`profile.ts:594-604`).
2. The submit-time validator is `(v) => v && !phoneRegex.test(v) ? "…" : null`. `v` is now
   `""` — falsy — so **no error is raised** (`:608, 620-626`).
3. `collectProfile()` sends `getValue("Mobile_Phone") || null` → `null` (`:491-492`).

The destruction happens in the input handler, before validation could ever object. The same
formatter also keeps only the first ten digits, so a pasted `+1 (321) 794-1376 x204` silently
becomes `132-179-4137` — a wrong number saved without a warning.

This is the church's contact data. Phone numbers are how a church reaches people in an
emergency, and this deletes them quietly, leaving an audit trail that looks deliberate.

## Where the new widget is already better — protect these

- Required-field and email validation work correctly (`notanemail` → *"Invalid email
  address"*). The phone path is the outlier, not the pattern.
- The widget edits a genuinely useful field set — prefix, names, nickname, suffix, gender,
  DOB, marital status, phones, email, SMS opt-in, bulk-email opt-out, photo, password —
  which legacy split across `mpp-household` dialogs. **Note the pair-table correction from
  C52: `next-profile` is not the counterpart of `mpp-about-me`.** About Me edits
  `Contact_Attributes` and touches none of these fields; they do not overlap at all. The
  legacy counterpart of this widget is `mpp-household`'s Edit Contact Info dialog.

## Phase 1 — stop the data loss

Two independent changes. **The second is the one that prevents loss even if the formatter is
changed again later**, so do both.

### 1. Do not destroy input in `formatPhone`

Format on `blur`, not on every keystroke, and leave the value alone when it contains letters
so the user's text survives to the validator and earns a real error message
(`Use format: 999-999-9999`). Dropping digits past the tenth also needs to stop — truncating
an extension into a wrong number is worse than rejecting it.

### 2. Distinguish "cleared on purpose" from "emptied by the formatter"

Keep the value each field held at render time. If a submitted value is empty **and** the
stored value was not, either require an explicit confirmation or treat the field as
untouched. Sending `null` should be reachable only when the user deliberately clears a field.

> **This is a repo-wide rule worth writing down, not a profile fix.** The `… || null` idiom in
> `collectProfile()` is the half of the bug that turns "empty" into "delete", independent of
> any mask, and it is the shape every editing widget will reach for. Audit
> `my-household.ts` and any other widget that PUTs a partial record, and state the rule in
> `CLAUDE.md`: *an empty submitted field is not a delete instruction when the stored value was
> non-empty.*

### 3. Pin it

`profile.test.ts`: typing letters must produce the `Use format: 999-999-9999` error, **and**
must never produce a payload whose `Mobile_Phone` is `null` while the loaded profile had one.

### Scope check — do not widen this

`next-profile` is the **only** widget with this mask.
`grep -rn "data-phone\|formatPhone\|replace(/\\D/g" packages/embed-sdk/src/components`
returns hits in `profile.ts` alone. `my-household.ts`, `plan-your-visit.ts` and the rest have
plain phone inputs and are not affected.

## Phase 2 — signed-out state

C53: anonymous load renders a bare **"Authentication required"** with a **Try Again** that
re-issues the same 401 forever, and no way to sign in. Of the three widgets in C53 this one
has the worst copy — not even an explanatory sentence. Handled by
`CROSS-1-signed-out-and-auth-states.md`; convert to the shared helper.

## Phase 3 — the bulk-email opt-out question

C55 is filed against `next-subscriptions` (which has no opt-out control), but the field lives
**here**, wired to `Contacts.Bulk_Email_Opt_Out`. The recommendation in `subscriptions.md` is
to surface it in both widgets, which creates a two-widget/one-field problem:

- A page carrying both will show stale state in one after the other saves. Either re-read on
  the `subscriptionsUpdated` / profile-saved events, or have both read through **one shared
  accessor**.
- **Use the same string in both.** `next-profile` currently has its own wording. Pick one
  (see the copy note in `subscriptions.md` about the double negative) and share it.

## Do better than parity

- **Legacy has no counterpart for this widget's scope.** `mpp-household`'s dialogs are
  narrower and worse organised, so there is no parity argument constraining the design here —
  this is a place to simply build the better profile page.
- **Phone handling is a chance to be genuinely good rather than merely non-destructive.**
  Accept what people actually type — `+1`, extensions, spaces, parentheses — normalise on
  blur *for display*, store what MP expects, and never discard characters the user cannot see
  disappear. The current mask is the worst of both: it edits the user's text and validates
  nothing.
- **Show what changed before saving.** This widget writes to a real contact record; a diff
  summary on submit ("Mobile phone: 321-794-1376 → cleared") would have made C51 impossible to
  ship and is a good property for any record-editing widget.

## Acceptance

- Typing `ZZTEST-abc` into a phone field shows a format error and does **not** clear the
  field.
- No payload can null a phone the loaded profile had, without an explicit clear.
- Pasting `+1 (321) 794-1376 x204` either validates or errors — it never saves
  `132-179-4137`.
- Anonymous load renders a sign-in prompt, not "Authentication required / Try Again".
- Unit tests cover both phone cases.

## Depends on / unblocks

Phase 2 depends on `CROSS-1`. Phase 3 coordinates with `subscriptions.md`. Phase 1 is
independent and **should be immediate** — of everything in this backlog, this is the item that
destroys customer data rather than merely failing to display it.
