# C64. `next-group-finder` cannot pre-set City / Postal Code from markup, though it renders and sends the field

**Widget:** `next-group-finder` (old: Group Finder, `/widgets/group_finder.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

`citypostalcode` is one of fifteen options in `mpp-group-finder`'s `observedAttributes`
(`https://mpi.ministryplatform.com/widgets/dist/GroupFinder.js`):

```
["countgroupinquiries","showfullgroups","showfuturegroups","targeturl","target",
 "congregationid","ministryid","keyword","parentgroupid","citypostalcode",
 "groupfocusid","lifestageid","meetingdays","showsuggestagroupbutton","grouptypeid"]
```

Legacy widgets bind attributes onto search-form fields by id, and the field is in
`GroupFinder.js`'s own template:

```html
<input name="cityPostalCode" class="mppw-form-field__control search-option advanced-option"
       type="text" id="cityPostalCode">
```

So `citypostalcode="90210"` pre-seeds a neighbourhood-scoped finder. It sits in the
`advanced-option` group, alongside `parentgroupid`.

## New behaviour

`next-group-finder` reaches parity on **fourteen** of the fifteen legacy options (see
CONFIG-MAP.md section 4.2) — `citypostalcode` is the one that did not make it. It is
absent from `observedAttributes` (`packages/embed-sdk/src/components/group-finder.ts:93`+).

The field itself is not missing, which is what makes this cheap to fix. The widget renders
it (`group-finder.ts:479-480`):

```html
<label for="gf-city">City or Postal Code</label>
<input id="gf-city" type="text" class="nw-gf-input" value="...">
```

reads it on submit (`:325-326`) and sends it (`:183`):

```ts
if (this.cityPostalCode) params.set("cityPostalCode", this.cityPostalCode);
```

The only thing absent is the markup path into `this.cityPostalCode`.

## Why it matters

Geographic pre-scoping is the normal way a church embeds a group finder on a
neighbourhood or campus landing page — "groups near you" without asking the visitor to
type a postcode. A church migrating `<mpp-group-finder citypostalcode="...">` finds every
other filter it used carried across and this one silently ignored, so the page returns the
whole domain's groups instead of the local ones. Silent is the problem: an unknown
attribute on a custom element throws nothing and logs nothing.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/group_finder.aspx`
- Old surface: `observedAttributes` brace-matched out of
  `https://mpi.ministryplatform.com/widgets/dist/GroupFinder.js`; the `#cityPostalCode`
  input in that bundle's template
- New surface: `packages/embed-sdk/src/components/group-finder.ts:93`+
  (`observedAttributes`), `:86` (`private cityPostalCode = ""`), `:183`, `:325-326`,
  `:479-480`
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.2

## Where to fix

`packages/embed-sdk/src/components/group-finder.ts` — `observedAttributes` (around line
93) and wherever the other filter attributes seed their fields.

## Suggested fix

Add `"city-postal-code"` to `observedAttributes` and seed `this.cityPostalCode` from it
the way `congregation-id`, `keyword` and the rest are seeded. The plumbing below it
(`:183`, `:325-326`) already works, so this should be a one-attribute change with no
service or route work. Decide deliberately whether an attribute-supplied value should also
*lock* the input as legacy does, or just pre-fill it — the rest of the new finder pre-fills
and leaves editable, so pre-fill is probably the consistent choice.
