# C56. `next-user-menu` silently drops child markup when signed in, so legacy `userUrls` custom menu links have no equivalent

**Widget:** `next-user-menu` (old: `mpp-user-login`)
**Severity:** functional
**Confidence:** confirmed — a child `<a>` appended to the live element in both auth states and its layout box measured; the signed-in shadow root dumped and its `<slot>` count checked
**Found:** 2026-09-08, comparison run

This is the runtime answer to CONFIG-MAP §7.2, which could not be settled
statically.

## Old behaviour

`mpp-user-login`'s `observedAttributes` is `[]`. Its one documented option in
MP's own `WidgetConfigurator` metadata is **`userUrls`**, typed `innerHTML` —
i.e. the church authors extra menu links as the element's **child markup** and MP
renders them inside the signed-in dropdown, alongside the built-in items.

The sample site passes none, so its signed-in menu shows only MP's two defaults:

```
Log Out          (no href — a JS handler)
My Profile       href="https://mpi.ministryplatform.com/ministryplatformapi/oauth/?profile"
```

The mechanism is a documented per-element option, which is what makes its absence
comparable rather than a guess.

## New behaviour

`next-user-menu` has nine attributes (`email`, `first-name`, `last-name`,
`image-url`, `mp-base-url`, `post-logout-redirect-uri`, `prefer-mp-login`,
`prevent-login-widget`, `session-scope`) and **none of them accepts menu items**.
Child markup is not an alternative, because the element only slots children in
one of its two states:

- **Signed out**, the shadow root is
  `<div class="nw-user-menu"><slot></slot></div>`. A child `<a>` appended to the
  element **does** render — measured at 143 x 21 px, `display: inline`. (This is
  also how legacy login works at all in `legacy` mode: `connectedCallback`
  appends `<mpp-user-login>` as a *child*, and the slot projects it.)
- **Signed in**, the shadow root is replaced wholesale by the avatar button:
  ```html
  <div class="nw-user-menu">
    <button class="nw-avatar-btn" aria-label="User menu" aria-haspopup="true" aria-expanded="false">
      <img class="nw-avatar-img" src="blob:…" alt="Christopher Kehayias">
    </button>
  </div>
  ```
  **`shadowRoot.querySelectorAll("slot").length === 0`.** The same child `<a>` now
  measures 0 x 0 with `assignedSlot === null` — it is in the light DOM, assigned
  to nothing, and painted nowhere. Opening the dropdown with the child present
  gives exactly the built-in set:
  `Christopher Kehayias · chris.kehayias@acst.com · My Account · Log out`.

So the host's markup is accepted without complaint in one state and discarded
without complaint in the other, which is the worst of the two possible
behaviours: an integrator who tests the widget signed out will believe custom
links work.

Separately worth recording: the new menu drops legacy's **My Profile** link to
MP's own OAuth profile page and replaces it with an in-widget **My Account**
modal (tabs Profile / Family / Groups / Giving / Subscriptions / Invoices). That
is a clear improvement and is *not* part of this finding — but it means there is
now no built-in item and no configuration option that can point a member at any
page of the church's choosing.

## Why it matters

The signed-in user menu is the one place a church site puts account links —
"Give", "My Serving Schedule", "Contact the office", a link into their own CMS.
Legacy let them author those as child markup with no code. Ours offers no
attribute, no slot in the state where the menu exists, and no event to inject
into the dropdown, so the only route is a fork of the component. Because the
markup silently works signed out, the failure is discovered after deployment, by
a signed-in member seeing a menu that is missing half its links.

## Evidence

- Screenshots:
  - `.claude/playwright/widget/screenshots/user-menu-new-custom-link-attempt.png` — signed in, a `ZZTEST Custom Link` child appended and nowhere visible
  - `.claude/playwright/widget/screenshots/user-menu-new-anon-baseline.png` — signed out, the same child rendering fine through the slot
  - `.claude/playwright/widget/screenshots/user-menu-new-authed-dropdown.png` — the built-in signed-in menu
  - `.claude/playwright/widget/screenshots/user-menu-old-authed-dropdown.png` — the legacy menu (Log Out / My Profile)
- Measured in-page:
  - signed out: `{ visible: true, w: 143.42, h: 21, display: "inline" }`
  - signed in: `{ visible: false, w: 0, h: 0, assigned: false }`, and
    `slot count in authed shadow: 0`
  - signed-in dropdown text with the child present:
    `Christopher Kehayias chris.kehayias@acst.com My Account Log out`
  - legacy menu items:
    `[{"text":"Log Out","href":null},{"text":"My Profile","href":"https://mpi.ministryplatform.com/ministryplatformapi/oauth/?profile"}]`
- Legacy option source: `userUrls`, `type: "innerHTML"`, from the
  `WidgetDetails.configurationItems` metadata inside
  `mpi.ministryplatform.com/widgets/dist/WidgetConfigurator.js`
  (CONFIG-MAP §4.17).

## Where to fix

- `packages/embed-sdk/src/components/user-menu.ts:1066-1090` —
  `renderDropdown()`, which hardcodes the item list
- `packages/embed-sdk/src/components/user-menu.ts:1060-1063` —
  `renderAvatar()`, the signed-in shadow content that has no `<slot>`
- `packages/embed-sdk/src/components/user-menu.ts:86-96` —
  `observedAttributes`, if the option becomes an attribute
- `packages/embed-sdk/src/components/user-menu.ts:709-712` — where
  `<mpp-user-login>` is appended as a child, i.e. why the light DOM is already
  load-bearing and cannot simply be repurposed

## Suggested fix

Give the dropdown a named slot and project the host's children into it:

```html
<div class="nw-dropdown">
  … header, divider, My Account …
  <slot name="menu-items"></slot>
  … Log out …
</div>
```

so a church writes
`<next-user-menu><a slot="menu-items" href="/give">Give</a></next-user-menu>`.
A named slot is important here rather than a default one, because the default
light DOM is already used for the injected `<mpp-user-login>` in `legacy` mode —
projecting unnamed children into the dropdown would put MP's login element
inside the signed-in menu.

Style the slotted anchors with `::slotted(a)` so they inherit the
`.nw-dropdown-item` look without the host having to know the class names, and put
the slot above **Log out** so sign-out stays last.

Whatever shape it takes, the silent-drop behaviour should go: if children are
present in the signed-in state and cannot be rendered, `console.warn` once, the
way the widget already warns when MPWidgets.js fails to register
`<mpp-user-login>`. And pin it with a test that appends a child in the
authenticated state and asserts it is assigned to a slot.
