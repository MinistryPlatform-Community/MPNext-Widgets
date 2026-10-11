# 45. Remove the five legacy attribute aliases after one release (C79)

**Depends on:** one release having shipped with both the kebab-case names and the aliases.
**Risk:** removing them early breaks host pages that still use the old spelling.
**Size:** 15 min.

Filed 2026-10-11 from the comparison-remediation epic's open follow-ups.

## What

The C79 rename kept the old spellings working for one release, through
`static attributeAliases` and `readAttr()`, which warns once per class:

- `my-giving.ts`: `hidesoftcredits`
- `my-groups.ts`: `hidegrouplife`
- `my-household.ts`: `hideaddhouseholdmember`
- `my-pledges.ts`: `hidecancelbuttonpledge`, `cancelpledgeemailtemplate`

## Do

Delete the `attributeAliases` entries, and the `observedAttributes` spread where nothing else
remains. Remove the old spellings from README "Migrating from MPWidgets.js" and from the
CLAUDE.md bullets that list them ("Attribute names are kebab-case", Code Conventions).

## Done when

No component declares an alias, `observed-attributes.test.ts` passes, and the docs no longer
mention the old spellings.
