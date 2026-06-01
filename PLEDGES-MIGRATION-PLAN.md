# Migration Plan: `next-my-pledges` widget

> Handoff doc to migrate the legacy `mpp-my-pledges` portal widget into this repo's
> embed SDK, following the established pattern used for `next-my-invoices`,
> `next-my-contribution-statement`, `next-statement-preferences`, `next-my-giving`,
> and `next-my-household`. Open this in a fresh session and execute.

## 0. Context

- **Repo:** `S:\MP\MPNext-Components` (pnpm monorepo, Next.js 16 + Vite embed SDK). Read `CLAUDE.md` first.
- **Branch:** `feature/legacy_widgets` (already checked out; keep committing here). Commit, do **not** push.
- **Legacy source:** `S:\MP\mp-Widgets\PortalComponents\...` (read-only reference repo).
- **Established pattern (mirror these exactly):**
  - Backend list-via-stored-proc + reuse: `src/services/contributionStatementService.ts`, `src/services/myGivingService.ts`, `src/services/invoiceService.ts`
  - Routes: `src/app/api/embed/my-giving/route.ts`, `src/app/api/embed/contribution-statements/route.ts`
  - A widget with a write/mutation: `src/app/api/embed/statement-preferences/route.ts` (GET+PUT) and `packages/embed-sdk/src/components/statement-preferences.ts`
  - Card/list widget: `packages/embed-sdk/src/components/my-invoices.ts`, `my-giving.ts`
  - Types: `packages/types/src/my-giving.ts`, `invoices.ts`
  - Demo: `packages/embed-sdk/demo-my-giving.html`
- **Avatar/auth note:** `requireWidgetAuth` supports a `"*"` wildcard for shared chrome; not needed here — use `widget: ["my-pledges", "user-menu"]`.
- **Commit message footer (required):**
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
  Use a bash heredoc to a temp file + `git commit -F` (NOT PowerShell `@'...'@` — that leaks literal `@` chars when run through the Bash tool).

## 1. What the legacy widget does

`mpp-my-pledges.js` is a **read + single mutation** widget (much simpler than household):

1. Auth-gated; shows login prompt when unauthenticated.
2. Lists the user's pledges as **cards**, each with:
   - Status badge (Active / Completed / Discontinued / Pending — mapped to localized labels).
   - Campaign image (`imageUrl`) or a **heart** icon fallback.
   - Campaign name + pledge-owner subtitle (`{contactFirstName} {contactLastName}`, blank if "null null").
   - **Progress bar**: `pledgeTotalToDate` of `totalPledge`. Percent = `pledgeTotalToDate >= totalPledge ? 100 : trunc(pledgeTotalToDate/totalPledge*100)`; `0` when `pledgeTotalToDate <= 0`. Bar text: `"{pledgeTotalToDateString} of {totalPledgeString} ({pct}%)"`.
   - Description line: `"{installmentsPlanned} installments beginning {firstInstallmentDate}"` (short date).
   - **Cancel button** shown only when `hidecancelbuttonpledge === "false"` AND `pledgeStatus === "Active"`.
3. **Cancel flow:** confirm dialog → cancel pledge → reload the list.
4. Empty state: "You are not associated with any pledges."

### Attributes (legacy → keep)
- `hidecancelbuttonpledge` — bool, **default true** (cancel hidden). Note the odd name (`...pledge` suffix). Keep the same attribute name for parity.
- `cancelpledgeemailtemplate` — Message/`dp_Communications` ID for the cancellation confirmation email. Optional. **See decision in §3.**
- `congregationid` — optional filter (passed to the proc).

## 2. Backend data model (authoritative — from the .NET legacy)

### List: stored procedure `api_MPPW_GetMyPledges`
- **Params:**
  - `@UserId` — the **dp_Users.User_ID** (NOT Contact_ID). Resolve via `dp_Users` by `User_GUID` (same `getUserByGuid` pattern; it already returns `User_ID`).
  - `@ImageBaseUrl` — string, set to `` `${MINISTRY_PLATFORM_BASE_URL}/files/` `` (env base already includes `/ministryplatformapi`). The proc concatenates this with the file GUID to build `ImageUrl`.
  - `@CongregationId` — number | null.
- **Returns** `result[0]` rows; map (snake/Pascal → camelCase) like `PledgeSQLToMyPledgeDTO`:
  | Row column | DTO field | Notes |
  |---|---|---|
  | `Pledge_ID` | `pledgeId` | number |
  | `Pledge_Campaign_ID` | `pledgeCampaignId` | number |
  | `Campaign_Name` | `campaignName` | string |
  | `Description` | `pledgeDescription` | string |
  | `First_Name` | `contactFirstName` | string\|null |
  | `Last_Name` | `contactLastName` | string\|null |
  | `Pledge_Status_ID` | `pledgeStatusId` | number (default 1 if absent) |
  | `Pledge_Status` | `pledgeStatus` | string ("Active"/"Completed"/"Discontinued"/"Pending") |
  | `Installments_Planned` | `installmentsPlanned` | number |
  | `First_Installment_Date` | `firstInstallmentDate` | string (pass through verbatim — parse defensively client-side) |
  | `ImageUrl` | `imageUrl` | string\|null (already absolute, built by proc) |
  | `Total_Pledge` | `totalPledge` | number |
  | `SubTotalAmount` | `pledgeTotalToDate` | number (amount given so far) |
  | `Event_Start_Date` / `Event_End_Date` | (optional) | not needed for the card |
  | `Trip_Leader` | (optional) | not needed |
  | `isMyMission` | (optional) | not needed |
- **Currency strings:** legacy formats `totalPledgeString` / `pledgeTotalToDateString` server-side via `.ToString("c")`. In the new widget, return raw numbers and format client-side with `Intl.NumberFormat("en-US",{style:"currency",currency:"USD"})` (consistent with `my-invoices`/`my-giving`). No need to return the pre-formatted strings.

### Cancel: update `Pledges`
- Operation: `updateTableRecords("Pledges", [{ Pledge_ID: pledgeId, Pledge_Status_ID: 3 }])` (3 = **Discontinued**).
- **Security:** before updating, verify the pledge belongs to the requesting user. The proc keys off `@UserId`; for the cancel route, re-fetch the user's pledges (or query `Pledges` joined to the donor's contact) and confirm `pledgeId` is in the caller's set. Simplest robust check: query `Pledges` with `Pledge_ID = {id} AND Donor_ID_Table.Contact_ID = {callerContactId}` and 403 if no match. (`getUserByGuid` returns `Contact_ID`.)
- **Confirmation email** (legacy sends one when `cancelEmailTemplateId` is set): see §3.

## 3. Decisions to confirm with the user before building

1. **Cancellation confirmation email.** Legacy optionally sends an MP Communication using `cancelpledgeemailtemplate`. Replicating this needs an email-manager equivalent (create `dp_Communications`/`Communication_Messages` records) that does **not** exist in this repo yet.
   - **Recommended default:** ship cancel **without** the email in v1 (the status update is the core behavior); keep the `cancelpledgeemailtemplate` attribute accepted-but-ignored, and add email sending as a follow-up if wanted. Flag this clearly.
2. **Cancel confirmation UX.** Legacy uses `window.confirm()`. In a Shadow-DOM embed, prefer an in-widget confirm (inline "Are you sure? [Cancel pledge] [Keep]") instead of `confirm()`. Recommended: in-widget confirmation.
3. **Read-only fallback:** if the user wants to keep it minimal, the cancel can be gated entirely behind `hidecancelbuttonpledge` (already the default-hidden behavior), so a read-only first cut is trivial.

## 4. Files to create

### Backend (one subagent)
1. `packages/types/src/my-pledges.ts` — Zod schemas + inferred types:
   - `PledgeSchema`: `{ pledgeId, pledgeCampaignId, campaignName, pledgeDescription, contactFirstName(nullable), contactLastName(nullable), pledgeStatusId, pledgeStatus, installmentsPlanned, firstInstallmentDate(string), imageUrl(nullable), totalPledge, pledgeTotalToDate }`.
   - `MyPledgesResponseSchema`: `{ pledges: Pledge[] }`.
   - `CancelPledgeRequestSchema`: `{ pledgeId: number }` (+ optional `cancelEmailTemplateId` if email is in scope).
2. `src/services/myPledgesService.ts` — singleton `MyPledgesService` (`getInstance`), wraps `MPHelper`:
   - `getUserByGuid(guid)` → `{ User_ID, Contact_ID }` (copy verbatim from `contributionStatementService.ts`).
   - `getPledges(userId, congregationId?)` → `executeProcedure("api_MPPW_GetMyPledges", { "@UserId": userId, "@ImageBaseUrl": `${mpBaseUrl}/files/`, "@CongregationId": congregationId ?? null })`; map `result[0]` → `Pledge[]`.
   - `verifyPledgeOwnedByContact(pledgeId, contactId)` → query `Pledges` `Pledge_ID = {id} AND Donor_ID_Table.Contact_ID = {contactId}`, return bool.
   - `cancelPledge(pledgeId)` → `updateTableRecords("Pledges", [{ Pledge_ID, Pledge_Status_ID: 3 }])`.
   - `mpBaseUrl = getEnv("MINISTRY_PLATFORM_BASE_URL")`.
   - **Watch for ambiguous-column errors** (we hit these on household): if any select uses a `_Table` FK join, qualify base columns (e.g. `Pledges.Pledge_ID`). The `verifyPledgeOwnedByContact` filter uses `Donor_ID_Table.Contact_ID`, so qualify `Pledges.Pledge_ID` / `Pledges.Pledge_Campaign_ID` in its select.
3. `src/app/api/embed/my-pledges/route.ts`:
   - `GET` → `requireWidgetAuth(req, { widget: ["my-pledges", "user-menu"] })`; `sub==="public"` → 401; resolve user; read optional `?congregationId`; return `{ pledges }`. Mirror `my-giving/route.ts` scaffolding (CORS, `buildFallbackCorsHeaders`, `OPTIONS`).
   - `POST` (cancel) → same auth; parse `{ pledgeId }` (Zod `safeParse`, 400 on fail); resolve user → `Contact_ID`; `verifyPledgeOwnedByContact` (403 if not owner); `cancelPledge`; return `{ success: true }` (or the refreshed `{ pledges }` so the widget can re-render without a second round trip — preferred).
   - `OPTIONS`.

### Frontend (one subagent)
4. `packages/embed-sdk/src/components/my-pledges.ts` — `class MyPledgesWidget extends MPNextWidget`:
   - `observedAttributes = ["hidecancelbuttonpledge", "cancelpledgeemailtemplate", "congregationid"]`. `hideCancelButton` default **true** (only `"false"` shows cancel). Pass `congregationid` as `?congregationId=`.
   - State: `pledges`, `loading`, `error`, plus a per-card `confirmingCancelId | null` for the in-widget confirm, and `cancelingId | null`.
   - `connectedCallback`: injectStyles → render → `loadPledges()`. Public `retryLoad()` (demo auth-poll calls it).
   - `loadPledges()`: GET `/api/embed/my-pledges` (+ congregation). `emit("pledgesLoaded", { count })`; on error `emit("pledgeError", {error})`.
   - Card render (reuse `my-invoices`/`my-giving` visual language: navy `#002855` header, brand `#004C97`, gold `#F1BE48`, rounded card, spinner, `:host{all:initial}`, mobile `@media`):
     - Status badge with label map: Active→"Active", Completed→"Completed", Discontinued→"Discontinued", Pending→"Pending".
     - Image (`imageUrl`) or inline **heart** SVG fallback.
     - Campaign name + owner subtitle (omit when "null null"/empty).
     - **Progress bar** (inline DOM/CSS, NOT a chart lib) with the percent math above and the `"$X of $Y (Z%)"` text.
     - Description: `"{installmentsPlanned} installments beginning {firstInstallmentDate}"` — format the date defensively (extract `YYYY-MM-DD`, build `new Date(y, m-1, d)`, no Z-shift).
     - Cancel button only when `hideCancelButton===false && pledgeStatus==="Active"`. Click → in-widget confirm → POST cancel → on success re-render from returned `{ pledges }` (or reload) + `emit("pledgeCanceled", { pledgeId })`.
   - Empty state: "You are not associated with any pledges." Error state with **Try Again** → `retryLoad()`. `escapeHtml`, `formatCurrency` helpers. Re-attach listeners after each render (the `my-invoices` pattern).
   - `customElements.define("next-my-pledges", MyPledgesWidget);`
5. `packages/embed-sdk/demo-my-pledges.html` — copy `demo-my-giving.html`; swap title/h1/tag/description; widget element `<next-my-pledges api-host="http://localhost:3000">`; `wid` → `"my-pledges"` everywhere; events → `pledgesLoaded`/`pledgeCanceled`/`pledgeError`; mention `hidecancelbuttonpledge`/`congregationid` attrs.

### Shared wiring (do yourself, NOT in subagents — these files collide)
- `packages/types/src/index.ts` → add `export * from "./my-pledges";` (alphabetical-ish; watch for any name collisions like the household `LookupOption` case — `Pledge`/`MyPledgesResponse` should be unique).
- `packages/embed-sdk/src/index.ts` → add `export { MyPledgesWidget }`, `import "./components/my-pledges";`, add `next-my-pledges` to the `detectApiHost` selector list, and `"NEXT-MY-PLEDGES": "my-pledges"` to `detectFirstWidgetId`.
- `packages/embed-sdk/src/shared/base-widget.ts` → add `next-my-pledges` to the sibling selector list.
- `packages/embed-sdk/index.html` → add a "My Pledges" card under the Authenticated section.

### User-menu Giving tab (the motivating follow-up)
- `packages/embed-sdk/src/components/user-menu.ts`, `case "giving":` currently still renders legacy `<mpp-my-pledges hidecancelbutton="true" customcss="${css}">`. Replace with `<next-my-pledges hidecancelbuttonpledge="true" api-host="${host}"></next-my-pledges>` (note attribute name `hidecancelbuttonpledge`).
- Then **remove `MyPledges.js`** from `loadMPWidgets()`. After that, the loader's only remaining entry is `MPWidgets.js` — and **nothing** in the modal uses legacy MP widgets anymore. Strongly consider removing `loadMPWidgets()` entirely plus the `customcss`/`mpWidgetCssUrl` plumbing and the `scriptsLoaded` state. Verify no other references first (`grep mpWidgetCssUrl|loadMPWidgets|MPWidgets|mpp-`). This is the payoff: the user-menu becomes 100% native.

## 5. Orchestration & verification

- Launch **two subagents in parallel** (backend / frontend), disjoint files, as done for the prior widgets. Tell each NOT to touch the shared-wiring files. Give them the field maps above and point them at the named reference files.
- Then wire the shared files yourself, swap the user-menu Giving tab, and remove the legacy pledges script.
- **Verify:** `pnpm build:sdk` (tsc + Vite bundle), `pnpm lint`, `npx tsc --noEmit -p tsconfig.json` — all must be clean.
- **Spot-check logic** (tsc won't catch): the proc param mapping (`@UserId` not contactId!), the ownership check in the cancel route, the progress-percent math, and defensive date parsing.
- **Commit** on `feature/legacy_widgets` with the co-author footer. Likely 2 commits: (1) `feat(embed-sdk): add my-pledges widget`, (2) `feat(user-menu): use native next-my-pledges + drop legacy MP widget loader`.

## 6. Gotchas learned on prior widgets
- **Ambiguous column names**: any select with a `_Table` FK join must qualify base columns (`Pledges.Pledge_ID`, etc.) and the filter too — MP 500s otherwise.
- **MP dates are wall-clock**: pass date strings through verbatim from the service; parse `YYYY-MM-DD` defensively client-side (never `new Date(isoWithZ)` for display/grouping).
- **No chart/3rd-party libs** in the SDK — progress bar is plain DOM/CSS.
- **`public/embed-sdk/` is gitignored** — commits are source-only; `build:sdk` just stages the bundle locally.
- **Currency**: format client-side; don't rely on server-formatted strings.
- The proc/table names (`api_MPPW_GetMyPledges`, `Pledges.Pledge_Status_ID`, status id `3`=Discontinued) match the legacy and the live `mpi.ministryplatform.com` tenant used for testing.
