# C20. `next-opportunity-finder` renders no Attributes filter at all: the config query names a column MP does not have, 500s, and the error is swallowed

**Widget:** `next-opportunity-finder` (old: Opportunity Finder — `/widgets/opportunity_finder.aspx`)
**Severity:** functional
**Confidence:** confirmed — reproduced in the browser on both sides, root-caused against the MP REST API
**Found:** 2026-09-08, comparison run

## Old behaviour

`mpp-opportunity-finder`'s Advanced Search panel carries an **"Attribute Type"**
`<select id="attributeType">` populated from
`GET /Api/OpportunitiesApi/GetConfigurations`. Captured payload contained **19
attributes in two `groupName` buckets**:

- *Occupation* — Carpenter, Doctor, Electrician, General Contractor, Grief Counselor, Nurse, Social Worker
- *Spiritual Gifts* — Administration, Evangelism, Exhortation, Faith, Hospitality, Leadership, Mercy, Serving, Shepherding, Teaching, Wisdom

Selecting one writes the hidden `#attributeIDs` field and filters the search.

## New behaviour

The Advanced Search panel has **five** controls (Congregation, Ministry, Gender,
Minimum Age, Frequency) and **no Attributes control**. `GET
/api/embed/opportunity-finder/config` returns
`{"congregations":2,"ministries":8,"genders":2,"attributeTypes":[]}` — always empty,
so `opportunity-finder.ts` (which only renders the field when
`this.config.attributeTypes.length`) drops it silently.

Root cause: `OpportunityFinderService.getAttributeTypes()` filters on
`ISNULL(Attributes.Available_Online, 1) = 1`, but the MP `Attributes` table has **no
`Available_Online` column** — its columns are `Attribute_ID, Attribute_Name,
Description, Attribute_Type_ID, Icon`. MP answers the query with
`500 {"Message":"Invalid column name 'Available_Online'."}`, and the surrounding
`try { … } catch { return []; }` turns that into an empty list with nothing logged.

The `attribute-ids` **attribute** still works (it is forwarded to
`api_MPPW_SearchOpportunities` as `@AttributeIDs`), so a site owner can hard-code a
filter — but no visitor can choose one.

## Why it matters

A church that recruits volunteers by skill or spiritual gift loses the only control
that does that. The filter is not degraded, it is invisible: no console error, no
empty dropdown, nothing in the network tab except a 200 config response with an empty
array. Anyone comparing the two finders would conclude the new one simply "has fewer
filters" rather than that a query is broken.

## Evidence

- Screenshots: `.claude/playwright/widget/screenshots/opportunity-finder-old-advanced-attribute-type.png`
  (19 options) vs `.claude/playwright/widget/screenshots/opportunity-finder-new-advanced-no-attributes.png` (no field)
- New config response, captured in-page: `{"congregations":2,"ministries":8,"genders":2,"attributeTypes":[]}`
- MP verification (client credentials, `MPHelper`):
  - the service's own query →
    `GET /tables/Attributes?$select=Attributes.Attribute_ID,…&$filter=ISNULL(Attributes.Available_Online, 1) = 1`
    → `500 {"Message":"Invalid column name 'Available_Online'."}`
  - the same query with the filter removed → 19 rows across Attribute Types
    2 (*Occupation*), 3 (*Spiritual Gifts*), 4 (*Group Tags*), 5 (*Persona*), 1 (*Allergies & Special Needs*)
  - `getTableRecords({ table: "Attributes", top: 1 })` → no `Available_Online` key

## Where to fix

`src/services/opportunityFinderService.ts:140-163` (`getAttributeTypes`).

## Suggested fix

Drop the `Available_Online` filter — the column does not exist. To keep the legacy
result set exactly, restrict to the attribute types the legacy API returns rather than
every type: legacy returned only types **2 (Occupation)** and **3 (Spiritual Gifts)**,
while an unfiltered query also yields *Group Tags*, *Persona (Synthetic)* and
*Allergies & Special Needs*, which would be new, wrong options. A
`Attribute_Type_ID_Table.Available_Online = 1` filter on **`Attribute_Types`** (verify
that column exists before using it) is the likely intent of the original code.
Separately, the bare `catch { return []; }` should log — it hid this for the whole
life of the widget.
