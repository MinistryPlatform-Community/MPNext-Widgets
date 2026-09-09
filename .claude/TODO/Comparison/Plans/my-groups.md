# `next-my-groups` — plan

**Items:** C13 (functional, shared) · C39 (functional, shared) · C79 (cosmetic, shared)
**Cutover verdict: C13 blocks cutover. Nothing else in this widget is wrong.**
**Owns:** `packages/embed-sdk/src/components/my-groups.ts`

## What the feedback says

This is the shortest plan in the set, because the widget is **correct**. Signed-in parity is
exact: two groups, same order, same "Leader" badge, same Group Connect links, matching
`api_MPPW_GetMyGroups` exactly.

Every item here is a shared class:

- **C13** — signed out, the widget renders its full error branch: *"Unable to Load /
  Authentication required. Please sign in. / [Try Again]"*, with **no sign-in control at all**.
  "Try Again" calls `retryLoad()`, which re-issues the same anonymous request — observed on
  the wire as `401 → 200 session → 401`. A loop with no exit. Legacy renders *"Please login to
  view your groups."* with a working Login button.
- **C39** — `attributeChangedCallback` guards on `oldValue !== null`, so `hidegrouplife` set
  from script after mount is ignored.
- **C79** — `hidegrouplife` is flat lowercase where 21 of 25 elements are kebab-case.

## Where the new widget is already better — protect these

- **Signed-in data parity is exact** against the proc. Nothing in this plan touches it.
- `my-groups.ts` carries a **`groupSvg()` helper** used for the no-photo case — which is the
  fix `group-finder.md` C18 row 12 wants, since the finder paints `NoImageText` as body text
  instead. Reuse it there; do not remove it here.

## Course of action

### C13 — per `CROSS-1-signed-out-and-auth-states.md`

Call sites: `loadGroups()` (`:60-81`), which treats any non-`ok` response as an exception and
stores the server's message in `this.error`, and `render()` (`:89-118`), which paints the
"Unable to Load" card for any error, 401 included. The widget has **no signed-out branch at
all**.

Branch on `res.status === 401` into a `needsAuth` state and render the shared sign-in panel.
`next-group-details` already has the shape (`group-details.ts:640-646`).

Two things the item is right to flag, both of which `CROSS-1` handles centrally rather than
here:

1. **The panel must not offer "Try Again"** — it cannot work.
2. **In `legacy` auth mode `AuthSession.login()` is not the live path**, so a Sign In button
   does nothing visible. The copy must read as an instruction — *"Please sign in above to see
   your groups"* — and the `loginRequired` event must stay cancelable so a host page that knows
   how to sign the user in can intercept. This is the mode-aware half of the shared helper.

**Do not close C13 by fixing this one widget.** It is one of ten in C81's class, and the point
of `CROSS-1` is that the eleventh widget cannot get it wrong.

**A note on how this hid.** `demo-my-groups.html` hides the widget behind
`#widget-container { display:none }` until the user signs in, so the broken state is invisible
on the demo as shipped — the test had to unhide it. A customer embedding `<next-my-groups>` on
a real page has no such guard, and **the anonymous state is what every first-time visitor
sees**. Worth checking whether other demo pages hide their signed-out state the same way; a
demo that hides the failing case is a demo that certifies it.

"My Groups" is a page a signed-out visitor reaches constantly — a bookmark, a nav link, a
returning member whose token lapsed. Legacy turns that into a one-click sign-in; ours tells
them the page is broken.

### C39 and C79 — per `CROSS-4-attribute-plumbing-and-naming.md`

`my-groups.ts` is one of exactly three components carrying the `oldValue !== null` guard
(with `my-giving.ts` and `my-pledges.ts`); `base-widget.ts` declares no
`attributeChangedCallback` of its own, so this is **not** a base-class defect and a base-class
fix would be the wrong shape. Drop the `oldValue !== null` half.

Rename `hidegrouplife` → `hide-group-life`, accepting the old spelling as a warning alias for
one release. The inconsistency is sharpest against `next-online-directory`, which renames the
same class of option to `hide-address` / `hide-email` / `hide-birthday-icon` — both are
"hide a section" booleans and they disagree on spelling.

## Do better than parity

- **The signed-out state is a recruitment opportunity, not a wall.** A visitor who lands on
  "My Groups" signed out is very likely someone who *wants* a group. Rather than a bare
  prompt, the panel could offer both: *"Sign in to see your groups"* **and** a link to the
  group finder. Neither system does this, and it turns a dead end into the site's most
  useful next step. Coordinate the link with `group-finder`'s `target-url` convention.
- **"Group Life" deserves a word.** `hide-group-life` is the widget's one option and its
  meaning is not obvious from the name — worth a line in the demo page and the customer
  snippet while renaming it.
- **Leader badges are good; leader actions would be better.** The widget already knows the
  member is a leader. What a leader wants from a group list is the roster and a way to message
  it — currently they get a badge and a link out.

## Acceptance

- Anonymous load renders a sign-in prompt with no "Try Again"; in `legacy` mode the copy names
  the page's own sign-in path rather than drawing a dead button.
- Setting `hide-group-life` on a mounted widget re-renders it; `hidegrouplife` still works and
  warns once.
- Signed-in output still matches `api_MPPW_GetMyGroups` exactly (regression guard).
- `demo-my-groups.html` no longer hides the widget from anonymous visitors, so the state is
  visible in the demo.

## Depends on / unblocks

C13 → `CROSS-1`. C39 and C79 → `CROSS-4`. This widget's `groupSvg()` helper is a dependency of
`group-finder.md`.
