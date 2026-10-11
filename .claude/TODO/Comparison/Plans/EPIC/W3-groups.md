# W3 — Groups (wave 1)

**Branch:** `ws/w3-groups`
**Items:** C10 · C11 · C12 · C13 · C14 · C15 · C16 · C17 · C18 · C19 · C64. It also does
C39 for `my-groups` and `group-details`, and the C79 rename for `hidegrouplife`.
**Design source:** `Plans/group-details.md`, `Plans/group-finder.md`, `Plans/my-groups.md`, `Plans/CROSS-1` (C15)
**Owns:**
- `group-finder.ts`, `group-details.ts`, `my-groups.ts`
- `groupsService.ts`
- `api/embed/{group-finder,group-details,my-groups}/**`
- group types in `packages/types`
- the `groupFinder` / `groupDetails` / `myGroups` namespaces in `locales/*/groups.ts`. **Do not
  touch** the `opportunity*` namespaces in the same file; W4 owns them.
- matching demo pages.

**Status at 2026-10-11:** C18 and C19 are partly fixed. Copy moved to the catalogue, and
`setMessages` can override it. Everything else is open.

## Order

1. **C12 — back-fill the inquiry row on the server.**
   - Problem: `groupsService.ts:443-448` trusts form fields. For a selected household member,
     fill `First_Name`, `Last_Name`, `Email`, `Phone` from MP via `getCurrentContact`
     (`:381-408`) or a household lookup.
   - **Never trust the client for a contact the user merely selected.**
   - Use `clean` from `_shared/mp-lookup.ts`.
   - W4's C21 is the same fix shape. They are independent, so each writes its own.
2. **C11 — send inquiry / sign-up / leader emails.**
   - Problem: the template attributes are declared and never read
     (`group-details.ts:72-74`, `inquire/route.ts:8-10`).
   - Thread `inquiry-email-template`, `signup-email-template` and
     `leader-signup-email-template` → route → `groupsService`.
   - Send through `MessageTemplateService`. Check in MP which template table legacy ids
     664/665 live in (`dp_Communication_Templates` vs `dp_Communications`) and choose
     `sendCommunicationTemplate` or `sendMessageTemplate` to match.
   - A template fault returns 200 with a soft warning. The row is already written.
   - Delete the "intentionally not ported" comments.
3. **C14 — sign up "Someone else".**
   - Add the blank-form option to the sign-up tab (`:730-734`).
   - On the server, resolve or create the contact before `resolveParticipantId` (`:492+`).
     Mirror how the inquiry path handles a blank form.
   - Remove the guard at `:270-273` and the throw at `groupsService.ts:467-470`.
4. **C16 — the inquiry phone is required.** The plan's default makes it required at `:758`
   via W0 `field({ required: true, type: "tel" })`. Optionally add a
   `require-inquiry-phone` attribute (default `true`).
5. **C17 — first-name greeting.**
   - In `displayNameFor` (`:348-355`), use `First_Name` (or `Nickname`). This needs
     `First_Name` added in `getHouseholdMembers` (`groupsService.ts:420`).
   - The copy is already `{name}`.
6. **C19 — remaining layout and tab semantics.**
   - Tabs at `:645,650,658` get `role="tablist"`, `role="tab"`, `aria-selected`,
     `aria-controls`, `role="tabpanel"`, and arrow-key roving.
   - Move the message next to the submit button (`:494`).
   - Use the `{label}` variant of `validation.required` from W0.
7. **C10 — cards.** At `group-finder.ts:595`, use W0 `cardLink()`.
8. **C15 — Suggest-a-Group.**
   - Gate at the button click, not at submit. Signed out, the click shows W0's
     `renderSignInRequired`, which is mode-aware.
   - Keep the 401 backstop non-destructive.
9. **C13 — my-groups signed out.**
   - Use W0 `renderSignInRequired()` (`my-groups.ts:73-76, 116-124`).
   - Also: C39 → W0 `reconfigure()` (`:56-60`). C79 → `hide-group-life` via `readAttr`, and
     delete its allowlist entry.
10. **C64.** Add `city-postal-code` to `observedAttributes` and `seedFromAttributes`
    (`group-finder.ts:146-155`).
11. **C18 — the copy decision.**
    - Apply the CROSS-5 principle: pick the better string, not the legacy one. Adopt
      legacy's *meaning* for the empty state ("0 groups found — try different criteria"),
      in the alert style, at `:547`.
    - Add a group icon in place of the photo text placeholder (`:562`).
    - Record the decisions in the C18 resolution.
12. **C39 variant in `group-details`** (`group-id && this.group`) → W0 `reconfigure()`.

## Protect
- All 11 group-finder filter combinations at exact parity.
- No unpublished, full, or ended group leaks.
- Suggest-a-Group writes domain wall-clock `Start_Date`.
- Inquire / SignUp return 200 (legacy 500s).
- `Someone else…` wording beats legacy's `Blank Form`.

## Stale-plan corrections
- `sendTemplateMessage` → `MessageTemplateService` (it exists now).
- The success copy is the catalogue keys `groupDetails.inquirySent*` / `signedUp*`.
- `MEETING_DAYS` is gone; use `fmt.weekdayNames`.
- C18 and C19 no longer "depend on C67".
- Line numbers are listed above.

## Acceptance
- The acceptance criteria in each design-source plan.
- A member inquiry row has name, email, and phone.
- Each configured template sends.
- Keyboard: finder → details → tabs.
- The `observed-attributes` guard allowlist has lost `hidegrouplife`.
- Epic gates pass.
