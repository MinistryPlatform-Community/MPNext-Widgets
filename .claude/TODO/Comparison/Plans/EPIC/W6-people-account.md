# W6: People & account (wave 1)

**Branch:** `ws/w6-people` · **Items:** C50 · C51 · C53 · C54 · C55 · C56 · C57 · C61. It also
does C39 for `my-household`, the C79 rename of `hideaddhouseholdmember`, and C81 adoption in
`online-directory` and `contact-attributes`.
**Design sources:** `Plans/online-directory.md`, `Plans/profile.md`, `Plans/my-household.md`,
`Plans/subscriptions.md`, `Plans/user-menu.md`.
**Owns:**
- Components: `online-directory.ts`, `profile.ts`, `my-household.ts`, `subscriptions.ts`,
  `user-menu.ts`, `contact-attributes.ts` (adoption only).
- Services: `onlineDirectoryService.ts`, `profileService.ts`, the household service,
  `subscriptionService.ts`.
- `src/lib/providers/ministry-platform/utils/http-client.ts` (C50 only).
- Their routes and types.
- Locale namespaces: the `subscriptions` namespace in `giving.ts` and the people/account
  namespaces in `people.ts` and `account.ts`. **`myInvoices` belongs to W1.**
- Their demo pages.

**Status at 2026-10-11:** all open.

## Order

1. **C50 (breaking).**
   - Problem: the `$select` at `onlineDirectoryService.ts:231-257` inlines an absolute image
     URL (`:256`), which pushes the query string past IIS's 2048-character limit.
   - Select the file GUID or id instead and build the URL in JS after the read.
   - Add a unit test asserting the built query-string length stays under 2048 when the
     base URL is long (W8 generalises this into a guard).
   - Change `http-client.ts:162-164` only if needed, and keep it compatible with every other
     caller.
2. **C51 (breaking, data loss).**
   - Problem: `formatPhone` (`profile.ts:616-627`) strips non-digits and destroys input.
   - Never mutate the value in the input handler.
   - Validate in `form-validation` instead: show an error for non-numeric input, and never
     send `null` for an unchanged field.
   - On the server, the profile route must not null a phone that the client did not send
     as an explicit clear.
   - Add a test: typing letters leaves the stored number intact.
3. **C53 + C81 adoption.**
   - Move `profile.ts:195-203`, `my-household.ts:274-284` and `subscriptions.ts:171-175` to
     W0 `renderSignInRequired()`.
   - Move `online-directory` and `contact-attributes` off their hand-rolled panels onto the
     helper, without changing their behaviour.
4. **C39 / C79.** In `my-household`, rename the attribute to `hide-add-household-member` and
   read it with `readAttr`; the attribute is observed today but never acted on. Wire it
   through W0 `reconfigure()`, then delete the allowlist entry.
5. **C54.** Adopt W0 `dialogFocus()` in `user-menu.ts`: the dropdown at `:1166-1170` and the
   modal at `:1208-1220`. Return focus to the trigger on Escape, and don't steal it back
   after an outside click.
6. **C56.**
   - Problem: `renderAuthenticated` (`user-menu.ts:689-691`) drops child markup.
   - Render a `<slot>` (or project the light-DOM `<a>` children) into the signed-in
     dropdown so custom links survive sign-in.
   - Don't regress `watchMpLoginRegistration()` or the legacy/dual branches.
7. **C55.**
   - Add a bulk-email opt-out toggle to `subscriptions` (Contacts `Bulk_Email_Opt_Out`).
   - Reuse `subscriptionService.ts:338-360`, which already writes it for `next-unsubscribe`.
   - Save per toggle, the same way the rest of the widget does.
8. **C61.**
   - Add a `congregation-id` attribute that filters publications.
   - Following `subscribe-to-publication.md:580/1558`, the filter is a plain column; check
     it with `mp_lookup`.
   - Thread it through the route and the two `Available_Online` filters
     (`subscriptionService.ts:197`, `:252`).
9. **C57: keep ours.** Record the resolution: month and day only, deliberately ("celebrates a
   birthday, not an age"), as the `my-household.md` recommendation says. Add a line for the
   migration guide. **No code change.**

## Protect
- Directory privacy:
  - unlisted phone and address are nulled server-side;
  - no email address is sent, only `canEmail`;
  - no birth year is sent.
- `next-subscriptions` saves per toggle.
- The user-menu account modal, Escape precedence, and the
  `watchMpLoginRegistration()` 300ms/6s loop.
- The `householdid` → `keyword="hh <id>"` convention.

## Stale-plan corrections
- `my-household.md` Phase 2 ("`Intl.DateTimeFormat` with `getMpTimezone()`") is moot under
  i18n `fmt` and the keep-ours decision.
- `profile.ts:349` is already `type="tel"`. Only the data loss remains.
- Line numbers have moved; the ones above are current.

## Acceptance
- A directory search runs on a long base URL.
- A non-numeric phone never wipes a stored number.
- All five auth-only widgets here show the shared sign-in state.
- User-menu focus returns to the trigger.
- Custom links survive sign-in.
- Bulk opt-out round-trips.
- The `congregation-id` filter works.
- Epic gates are green.
