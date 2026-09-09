# C63. `next-plan-your-visit` cannot set the user-notification email template, although the service already accepts it

**Widget:** `next-plan-your-visit` (old: Plan Your Visit, `/widgets/plan_your_visit.aspx`)
**Severity:** functional
**Confidence:** confirmed — static source read on both sides, including the server that already supports the value; no browser used
**Found:** 2026-09-08, comparison run (config cartographer)

## Old behaviour

The sample page configures seven options, and one of them is the confirmation email the
**visitor** receives:

```html
<mpp-plan-your-visit
  returnUrl="https://mpi.ministryplatform.com/planyourvisit/"
  verificationEmailTemplateId="122"
  userNotificationEmailTemplateId="131"
  churchNotificationEmailTemplateId="132"
  collectAddress="true"
  milestoneToAssignId="2"
  milestoneProgramId="3"></mpp-plan-your-visit>
```

All seven are in `observedAttributes` in `/widgets/dist/PlanYourVisit.js`, and all seven
appear in `getAttribute(...)` calls in that bundle:

```
["verificationemailtemplateId","returnurl","userNotificationemailtemplateid",
 "churchnotificationemailtemplateid","collectaddress","milestonetoassignid","milestoneprogramid"]
```

Note the three distinct emails: `verificationEmailTemplateId` (the "click to confirm"
link), `userNotificationEmailTemplateId` (the visitor's confirmation), and
`churchNotificationEmailTemplateId` (the staff heads-up).

## New behaviour

`next-plan-your-visit` declares eight attributes and **`user-notification-email-template-id`
is not among them** (`packages/embed-sdk/src/components/plan-your-visit.ts:69`+):

```
["api-host","church-notification-email-template-id","collect-address",
 "milestone-program-id","milestone-to-assign-id","return-url",
 "verification-email-template-id","verify-param-name"]
```

The register payload sends only the church template (`plan-your-visit.ts:282-283`):

```ts
churchNotificationEmailTemplate:
  this.getAttribute("church-notification-email-template-id") || null,
```

What makes this a narrow fix rather than a design gap is that **the server side already
implements it**. `src/services/planYourVisitService.ts:495-498`:

```ts
const userTemplateId =
  toNumberOrNull(model.userNotificationEmailTemplate ?? null) ??
  (await this.getCongregationEmailTemplate(model.congregationId));
```

The request model has the field; the widget never populates it, so every visitor email
falls through to the congregation's `Plan_A_Visit_Template`.

## Why it matters

A church that runs several Plan Your Visit pages — a Christmas Eve page, a campus launch
page, a Spanish-language page — sends a different visitor confirmation from each on the
legacy stack, by changing one attribute per embed. On the new widget all of them collapse
to the single per-congregation template, with no markup that can override it. The church
notification stayed configurable while the visitor-facing one did not, which is the wrong
way round: the visitor email is the one a church actually wants to tailor.

## Evidence

- Old markup: `curl https://mpi.ministryplatform.com/widgets/plan_your_visit.aspx`
- Old surface: `observedAttributes` + `getAttribute` list from
  `https://mpi.ministryplatform.com/widgets/dist/PlanYourVisit.js`; descriptions from the
  `WidgetDetails` record in `/widgets/dist/WidgetConfigurator.js`
- New surface: `packages/embed-sdk/src/components/plan-your-visit.ts:69`+ (attribute list)
  and `:282-283` (payload)
- Server already supports it: `src/services/planYourVisitService.ts:495-498`
- No screenshot: static-only item by design
- Parity table: `.claude/playwright/widget/CONFIG-MAP.md` section 4.7

## Where to fix

- `packages/embed-sdk/src/components/plan-your-visit.ts` — add
  `user-notification-email-template-id` to `observedAttributes` and to the register payload
  as `userNotificationEmailTemplate`
- `src/app/api/embed/plan-your-visit/register/route.ts` — confirm the request schema in
  `@mpnext/types` carries the field through to `PyvRegisterRequest`

## Suggested fix

Three lines in the widget plus a schema field, if `PyvRegisterRequest` already declares
`userNotificationEmailTemplate` — check `packages/types` first, since the service reads it
via `model.userNotificationEmailTemplate` and Zod would strip an undeclared key before it
ever reached there. Keep the existing congregation fallback: the `??` chain in the service
is the right precedence (explicit attribute wins, congregation default otherwise).
