# user-menu — comparison test log

- **New**: `next-user-menu` — http://localhost:5173/demo-user-menu.html (and present on all 25 demo pages)
- **Old**: `<mpp-user-login>` — on every page under https://mpi.ministryplatform.com/widgets/
- **Tested**: 2026-09-08 by subagent PEOPLE (block C50–C59)
- **Auth state(s) tested**: signed out, sign-in, signed in, sign-out, and re-login after sign-out — on **both** sites
- **Script**: `…/scratchpad/people-recon-anon.mjs`, `people-anon2.mjs`, `people-authed-new.mjs`, `usermenu.mjs`, `slot.mjs`
- **Resolved auth mode for this run**: `legacy` (`GET /api/embed/auth/config` → `{"mode":"legacy",…}`), so `next-user-menu` takes its `legacy` branch and hosts MP's own `<mpp-user-login>` when signed out.

Read before testing, as instructed: `packages/embed-sdk/src/components/user-menu.ts`
(1,790 lines). Demo markup is
`<next-user-menu mp-base-url="https://mpi.ministryplatform.com" api-host="http://localhost:3000">`.
Per CONFIG-MAP §4.17, legacy `mpp-user-login` has `observedAttributes` `[]` and
one documented option, `userUrls` (typed `innerHTML`); all nine of ours are
new-only. The sample site passes no `userUrls`, so testing that half required
supplying child markup myself.

## What I tested

1. **Signed-out first paint, new.** Clean context. Waited ~9 s for
   `watchMpLoginRegistration()` to get `<mpp-user-login>` upgraded, then dumped
   the light DOM, the shadow DOM, and the injected element's attributes.
2. **`watchMpLoginRegistration()` actually works.** Confirmed the injected
   element is upgraded (`shadowRoot` present) after the async
   `GET /api/embed/auth/config` step — the MPWidgets.js `DOMContentLoaded` race
   described in CLAUDE.md.
3. **TODO item 38.** Checked at runtime whether the injected `<mpp-user-login>`
   carries a `customcss` attribute, what stylesheets reach its shadow root,
   whether `window.__nextEmbedCSSUrl` is defined, and whether the brand colour
   arrives. See the verdict section.
4. **Sign-in, both sites.** Full interactive MP login through the widget
   (`harness.loginNew` / `loginOld`), then `assertAuthenticated`.
5. **Signed-in display, both sites.** Trigger element, its ARIA, whether it shows
   a name or an avatar image.
6. **Menu items, both sites.**
7. **Keyboard.** Escape on the dropdown, Escape on the account modal, and where
   focus lands afterwards. Modal `role` / `aria-modal` / `aria-label` / tab set.
8. **CONFIG-MAP §7.2 (`userUrls`).** Appended a child `<a>` to the live element in
   **both** auth states and measured its layout box and `assignedSlot`; counted
   `<slot>`s in the signed-in shadow root; opened the dropdown with the child
   present.
9. **Sign-out, both sites.** Clicked Log out / Log Out, followed the navigation,
   and read what was left in `localStorage`.
10. **Does sign-out actually end the MP IdP session?** After signing out, loaded
    the page again, clicked Login, and checked whether MP showed the credential
    form or bounced straight back in.
11. **Responsive.** 390 x 844.

## Results

| # | Check | Old (`mpp-user-login`) | New (`next-user-menu`) | Verdict |
|---|---|---|---|---|
| 1 | Signed-out paint | `<a id="loginButton"><div class="mppw-icon-unlock"><span class="mppw-loggedout--label">Login` | appends `<mpp-user-login>` as a child and slots it — so it paints **MP's own** control, identically | pass |
| 2 | `watchMpLoginRegistration()` | n/a (tag is in the .aspx markup at MPWidgets.js scan time) | injected after `auth/config` resolves and **still upgraded** (`shadowRoot` present) | pass — the CLAUDE.md race is handled |
| 3 | Sign-in works | yes | yes — top-level nav to `/ministryplatformapi/oauth/login`, username/password, back with `?cacheKey=…`, `mpp-widgets_*` written, `ver: 1` JWT minted | pass |
| 4 | Signed-in trigger | `<a id="userNameContainer">` with `#userImage` (background-image) + `#userDisplayName` "Chris Kehayias" — **name is visible** | `<button class="nw-avatar-btn" aria-label="User menu" aria-haspopup="true" aria-expanded="false">` with `<img class="nw-avatar-img" alt="Christopher Kehayias">` — **avatar only, name inside the dropdown** | difference, not filed — see below |
| 5 | Trigger semantics | anchor, no ARIA at all | real `<button>` with `aria-label`, `aria-haspopup`, live `aria-expanded` | **new is better** |
| 6 | Menu contents | `Log Out` (no href) · `My Profile` → `https://mpi.ministryplatform.com/ministryplatformapi/oauth/?profile` | header with `Christopher Kehayias` + `chris.kehayias@acst.com`, divider, `My Account`, `Log out` (+ `Contribution Statement` in tax season, Dec 15 – Apr 15) | see below |
| 7 | Account surface | link out to MP's OAuth profile page | in-widget modal: `role="dialog" aria-modal="true" aria-label="My Account"`, tabs **Profile / Family / Groups / Giving / Subscriptions / Invoices**, portalled to `document.body` | **new is much better** |
| 8 | Escape closes the dropdown | no Escape handling | **yes** | **new is better** |
| 9 | Escape closes the modal | no modal | **yes**, and `handleEscape` prefers the modal when both are open | **new is better** |
| 10 | **Focus returns to the trigger on close** | focus stays on the anchor (no re-render) | **no** — `document.activeElement` is `<body>` after Escape, for both the dropdown and the `aria-modal` dialog | **C54** |
| 11 | Focus trap in the modal | n/a | not implemented (Escape works; Tab is not trapped) | in C54 |
| 12 | Dropdown roles | none | `.nw-dropdown` has no `role`; items are plain `<button>`s | acceptable (disclosure pattern) — recorded in C54, not filed separately |
| 13 | **Custom menu links (`userUrls`)** | child markup, documented option, rendered in the signed-in menu | signed **out**: child renders through `<slot>` (143 × 21 px). Signed **in**: `slot count === 0`, child measures 0 × 0, `assignedSlot === null`, dropped **silently** | **C56** |
| 14 | Sign-out clears local state | leaves `mpp-widgets_AuthToken`, `mpp-widgets_IdToken`, `mpp-widgets_ExpiresAfter` in `localStorage` | leaves **nothing** — every `mpp-*` and `nw_*` key gone | **new is better** |
| 15 | **Sign-out ends the MP IdP session** | yes — re-clicking Login shows MP's credential form (`#username` visible) | **yes** — re-clicking Login lands on `/ministryplatformapi/oauth/login` with `#username` visible | **pass — the thing I was asked to verify** |
| 16 | Where sign-out lands | back on `/widgets/my_household.aspx` | on MP's `…/oauth/login` page | difference, not filed — see below |
| 17 | Responsive 390 x 844 | usable | usable | pass |

## TODO item 38 — runtime verdict

**Item 38's reading 2 is correct: nothing sets `customcss`, and the brand CSS
never reaches MP's shadow DOM.** Measured on the live injected element in
`legacy` mode:

- `document.querySelector("next-user-menu mpp-user-login")` →
  **`attrs: []`** — the injected element carries **zero attributes**. No
  `customcss`, nothing.
- Its shadow root contains exactly **one** stylesheet:
  `https://mpi.ministryplatform.com/widgets/Content/mppw-widgetstyles.css`
  (MP's own). `0` inline `<style>` tags, `0` `adoptedStyleSheets`.
- Computed colour of `#loginButton` and `.mppw-loggedout--label`:
  **`rgb(74, 149, 236)`** — MP's default blue. Brand primary `#004C97` is
  `rgb(0, 76, 151)`. The override CSS is not in effect.
- `window.__nextEmbedCSSUrl` is **`undefined`** on the demo pages.
- Source confirms it: `packages/embed-sdk/src/components/user-menu.ts:709-712`
  does `this.appendChild(document.createElement("mpp-user-login"))` and sets no
  attribute; `grep -n "customcss\|__nextEmbedCSSUrl\|injectExternalCSS"` over
  that file returns nothing. Repo-wide, `__nextEmbedCSSUrl` appears only in
  `scripts/hash-sdk.js:98` (which writes it), `public/embed-sdk/next-embed.js:6`
  (the generated loader that assigns it) and
  `packages/embed-sdk/src/index.ts:250` (the `Window` type declaration). **No
  reader exists.**

One extra wrinkle worth recording before anyone implements step 2 of item 38:
`__nextEmbedCSSUrl` is set **only by the generated loader**
(`public/embed-sdk/next-embed.js`). The demo pages import the SDK module
directly from Vite, so even code that read the global would find it `undefined`
in dev and in any host page that imports the ES bundle rather than the loader.
The fix therefore needs a fallback — derive the URL from the widget's `api-host`
(or from `import.meta.url`) when the global is absent — or it will work in
production and silently do nothing locally, which is how this got lost in the
first place.

**This is a different question from C68**, and the two should not be merged.
C68 is that no `next-*` widget can be restyled at all (no `customCss`, no
`GetCustomStyles` channel, and `injectStyles()` *assigns*
`adoptedStyleSheets`). Item 38 is narrower: whether the brand override CSS
reaches **MP's** shadow DOM on the `<mpp-*>` element our widget injects. It does
not. `mp-widget-overrides.css` is content-hashed, staged, cache-headered and
advertised, and read by nobody.

I did not file a C-item for this, as instructed.

## Findings filed

- `C54-user-menu-no-focus-return-on-close.md` — Escape closes the dropdown and
  the `aria-modal` dialog, but focus is left on `<body>` instead of returning to
  the avatar trigger; the modal also has no Tab trap.
- `C56-user-menu-drops-child-markup-no-custom-links.md` — child markup is slotted
  when signed out and silently discarded when signed in, so legacy `userUrls`
  custom menu links have no equivalent. (This settles CONFIG-MAP §7.2.)

## Where the new widget is better

- **A real button with real ARIA.** `aria-label="User menu"`,
  `aria-haspopup="true"`, and `aria-expanded` that actually tracks state. Legacy
  is an `<a href="#">` with none of it.
- **Escape works** on both the dropdown and the modal, and prioritises the modal.
  Legacy has no keyboard affordance at all.
- **A proper dialog.** `role="dialog"`, `aria-modal="true"`,
  `aria-label="My Account"`. Legacy has no dialog.
- **The account modal replaces a link-out with a real surface** — six tabs
  (Profile, Family, Groups, Giving, Subscriptions, Invoices) hosting the other
  widgets, plus hash deep-linking (`#next-tab=giving`). Legacy sends the member
  off-site to MP's OAuth profile page.
- **Sign-out leaves no token material behind.** Legacy leaves
  `mpp-widgets_AuthToken`, `mpp-widgets_IdToken` and `mpp-widgets_ExpiresAfter`
  sitting in `localStorage` after logout — ours clears every `mpp-*` and `nw_*`
  key.
- **The registration watch is genuinely needed and genuinely works.** MPWidgets.js
  only loads bundles for tags present during its own `DOMContentLoaded` scan, and
  ours injects `<mpp-user-login>` after an awaited `auth/config` round trip.
  `watchMpLoginRegistration()` gets it upgraded anyway. This is the sort of thing
  that is normally discovered broken.

## Not tested / blocked

- **`dual` and `hardened` modes.** The resolved mode for this run is `legacy`
  (a server setting shared with five sibling agents), so the widget's own
  Sign In button, `GET /api/embed/auth/me`, `POST /api/embed/auth/exchange`, the
  `#nw_auth` handoff and `POST /api/embed/auth/logout` were **not** exercised.
  Changing `EMBED_AUTH_MODE` would have broken every other agent's session.
  Unblocked by `EMBED_AUTH_MODE_ORIGINS=http://localhost:5173=dual` plus
  registering the callback URI, on a run of its own.
- **`prefer-mp-login`, `prevent-login-widget`, `session-scope="tab"`,
  `post-logout-redirect-uri`, `image-url`, `first-name`/`last-name`/`email`
  overrides** — none exercised. `prefer-mp-login` is `dual`-only by design
  (`user-menu.ts:125`), and the rest change the same paths the mode gate closes.
- **Tax-season menu item.** `isTaxSeason()` is Dec 15 – Apr 15 and today is
  2026-09-08, so the `Contribution Statement` item is correctly absent and its
  behaviour is untested. Its presence in the source is recorded above.
- **The account modal's tab contents** were not driven — each tab hosts another
  widget owned by a different agent on this run (giving, invoices, groups). Only
  the modal shell, its ARIA and its tab labels were checked.
- **Row 4 (avatar-only trigger) is recorded, not filed.** Legacy shows the
  member's name next to the photo; ours shows only the avatar and moves the name
  into the dropdown. That is a defensible density choice for a site header and
  the `aria-label` keeps it accessible, but a church used to seeing "Chris
  Kehayias" in the corner will notice.
- **Row 16 (where sign-out lands) is recorded, not filed.** Legacy returns the
  member to the widget page they were on; ours leaves them on MP's own login
  page. In `legacy` mode the SDK cannot do better without a registered
  post-logout URI, and CLAUDE.md is explicit that host-site origins are
  deliberately never registered with MP (`buildEndSessionUrl()` takes no
  destination). `post-logout-redirect-uri` exists for integrators who *have*
  registered theirs. So this is a documented constraint rather than a defect —
  but it is the most visible difference a member will experience, and it is worth
  a line in the migration guide.
- **`mpp-user-label`** (C77, already filed) has no sample page and was not driven.

## MP records changed

**None.** This widget was tested read-only apart from authentication itself.

Note for siblings: this test signed out of the MP IdP session twice (once per
site), which invalidates the shared SSO cookie in
`…/scratchpad/state-new.json` / `state-old.json`. Both state files were
**re-created with a fresh interactive login at the end of the run** and re-saved
(`saveState`), so the next agent to call `launch({ authed: true })` gets a valid
session. The 30-minute `mpp-widgets_ExpiresAfter` window restarted at that point.

## Screenshots

- `screenshots/user-menu-new-anon.png`, `screenshots/user-menu-new-anon-baseline.png` — new, signed out (MP's `<mpp-user-login>` slotted in)
- `screenshots/user-menu-new-anon-detail.png` — the same, captured while dumping the injected element's (empty) attribute list for item 38
- `screenshots/user-menu-new-authed.png` — new baseline, signed in (avatar in the site bar)
- `screenshots/user-menu-old-authed.png` — old baseline, signed in (photo + name)
- `screenshots/user-menu-new-authed-dropdown.png` — new dropdown: name, email, My Account, Log out
- `screenshots/user-menu-old-authed-dropdown.png` — old dropdown: Log Out, My Profile
- `screenshots/user-menu-new-authed-modal.png` — the account modal and its six tabs
- `screenshots/user-menu-new-custom-link-attempt.png` — **C56**: a child link appended while signed in, rendered nowhere
- `screenshots/user-menu-new-authed-mobile.png` — 390 × 844
- `screenshots/user-menu-new-after-logout.png` / `screenshots/user-menu-old-after-logout.png` — where each sign-out lands
- `screenshots/user-menu-new-relogin-after-logout.png` — MP's credential form on re-login, i.e. the IdP session really ended
