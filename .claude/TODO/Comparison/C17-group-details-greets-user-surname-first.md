# C17. `next-group-details` greets the user surname-first after a successful inquiry or sign-up — "Thanks, Kehayias Chris!"

**Widget:** `next-group-details` (old: `mpp-group-details`, `/widgets/group_details.aspx`)
**Severity:** cosmetic
**Confidence:** confirmed — observed in the browser after a real inquiry submit, and traced to the exact line
**Found:** 2026-09-08, comparison run (groups agent)

## Old behaviour

Legacy's post-submit confirmation does not personalise at all — it shows a generic alert
(and on this MP instance the inquiry POST 500s after the insert, so what actually appeared
was its error banner). There is no surname-first greeting to compare against; the defect
is self-contained in the new widget.

## New behaviour

Submitting an inquiry as the signed-in Playwright user, with the picker on its default
selection "Kehayias, Chris", produced:

> **Thanks, Kehayias Chris! Your message has been sent to the group.**

The sign-up branch has the same bug: `You're signed up, Kehayias Chris! …`.

The cause is that the greeting is built from MP's `Display_Name`, which is
`"Last, First"`, and the comma is stripped rather than the parts reordered
(`group-details.ts:318-325`):

```ts
private displayNameFor(tab: Tab, payload: { firstName: string | null; lastName: string | null }): string {
  const id = tab === "inquire" ? this.inquireContactId : this.signupContactId;
  if (id && id !== "blank") {
    const member = this.contact?.members.find((m) => String(m.contactId) === id);
    if (member) return member.displayName.replace(/,/g, "");   // "Kehayias, Chris" -> "Kehayias Chris"
  }
  return [payload.firstName, payload.lastName].filter(Boolean).join(" ");
}
```

used at `group-details.ts:306` and `:309`. The fallback branch (the "Someone else…" path,
which reads the typed first and last name) is correct — only the household-member path,
which is the default and by far the common one, inverts the name.

## Why it matters

It is the last thing the visitor reads at the end of a flow they just committed to, and
getting somebody's name backwards reads as carelessness in a way a misaligned border does
not — particularly for a church, and particularly for members whose surname is also a
plausible given name. Cheap to fix, disproportionately visible.

## Evidence

- Screenshot: `.claude/playwright/widget/screenshots/group-details-new-inquiry-submitted.png`
- Observed shadow text: `← Back to groups Thanks, Kehayias Chris! Your message has been
  sent to the group. Kehayias Home Group …`
- Picker state at submit: `NEW picker default: {"value":"98","selectedText":"Kehayias, Chris"}`
- The picker source is `GroupsService.getHouseholdMembers()`
  (`src/services/groupsService.ts`), which selects
  `Contacts.Display_Name AS DisplayName` — i.e. `"Last, First"` by MP convention
- Script: `.claude/playwright/widget/scripts/groups-gd-write.mjs` (`SIDE=new`)

## Where to fix

`packages/embed-sdk/src/components/group-details.ts:318-325` (`displayNameFor`).

## Suggested fix

Split on the comma and swap, rather than deleting it:

```ts
if (member) {
  const [last, first] = member.displayName.split(",").map((s) => s.trim());
  return first ? `${first} ${last}` : last;
}
```

Guard for a `Display_Name` with no comma (some MP records carry a single-token display
name) by falling through to the raw value, as above. A first name alone would read better
still — "Thanks, Chris!" — and the service already has `First_Name` for the signed-in
contact, though not for the other household members; if the greeting is worth the extra
column, add `First_Name` to the `getHouseholdMembers()` select and use it, which also
removes the string parsing entirely. Check the same `.replace(/,/g, "")` idiom has not been
copied into other widgets that render `Display_Name`.
