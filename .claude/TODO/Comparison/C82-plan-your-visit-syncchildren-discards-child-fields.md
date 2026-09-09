# C82. `next-plan-your-visit` wipes every typed child field when a child is added or removed

**Widget:** `next-plan-your-visit` (old: `/widgets/plan_your_visit.aspx`)
**Severity:** functional
**Confidence:** confirmed — measured in the browser by the serving & visit agent, then
verified in source by the main thread.
**Found:** 2026-09-08, comparison run

Filed at consolidation: the discovering agent had used all ten numbers in its reserved
block (C20–C29) and recorded this one in its test log and in C24's "Where to fix" rather
than dropping it or bundling it into another item. It is a separate defect from C24 and
needs its own fix.

## Behaviour

Type a child's name, gender and age group, then add a second child (or remove one). Every
field of every existing child is blank again except the date of birth. The visitor must
retype all of it, and there is no warning that it happened.

## Old behaviour

The legacy widget preserves already-entered child rows across add and remove.

## Why it matters

Plan Your Visit exists to capture a family before they arrive, so multiple children is the
normal case, not an edge case. The data loss fires precisely when a parent does the
expected thing — enter one child, then add the next — and it silently discards work the
visitor already did. A parent who does not notice submits a household whose children are
half blank; one who does notice retypes everything, or gives up.

Compounding it: this widget also cannot be submitted at all right now (**C24**), so once
C24 is fixed this becomes the next thing a visitor hits. Fix them together.

## Evidence

- `packages/embed-sdk/src/components/plan-your-visit.ts:326-331` — `syncChildren()` reads
  back **only** the date of birth before the re-render:

  ```js
  private syncChildren() {
    for (const c of this.childRows) {
      const dob = this.root.querySelector<HTMLInputElement>(`[name="child-${c.key}-dob"]`);
      if (dob) c.dob = dob.value;
    }
  }
  ```

  `addChild()` calls `syncChildren()` and then re-renders from `this.childRows`, so any
  field not copied back into that array is gone. Name, gender and age group are never
  copied back.
- Browser measurement and screenshots: `.claude/playwright/widget/tests/plan-your-visit.md`.

## Where to fix

`packages/embed-sdk/src/components/plan-your-visit.ts:326-331`, and the `childRows` row
type it populates.

## Suggested fix

Copy back every child input, not just `dob` — widen the row type to carry name, gender and
age group, and have `syncChildren()` read each one the same way. The `name="child-<key>-*"`
convention already makes them addressable, so this is a small change.

The underlying shape is the real lesson: re-rendering from an in-memory array that only
partially mirrors the DOM will keep producing this bug as fields are added to the form. If
the form grows again, read the row back by iterating the rendered inputs rather than by
naming each field to preserve.
