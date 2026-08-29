# Notify action — per-node channel picker

## Problem

The workflow `notify` action always delivers on whatever the notify job's default
map says for `NotificationEvent.Workflow` — in-app plus email, never Slack. The
author has no say, and Slack is unreachable from a workflow even for companies
that have connected it.

## Outcome

A "Notification type" field on the notify node: a multi-select over In-app,
Email and Slack. The chosen channels ride to the notify job as `destinations`,
which the job already accepts.

## Decisions

- **In-app is locked on.** `notify.ts` force-adds `NotificationDestination.InApp`
  to every notification so the topbar reflects everything; that is a platform-wide
  contract, not a workflow one. The option renders checked and disabled with
  "Always sent" underneath, which is the truth rather than a switch that does
  nothing.
- **The field is optional, not required.** With in-app locked on, "required"
  could only ever be satisfied trivially — and a required input would block
  publish on notify nodes saved before this field existed, in a picker where
  the author cannot tick the one channel that is actually on. `defaultValue`
  seeds `["inApp", "email"]` on every new node instead, so the field is filled
  in practice and an absent value keeps today's behaviour.
- **Unavailable channels are disabled with a reason.** Email needs a Business or
  Partner plan; Slack needs the company's Slack integration active. The job skips
  a channel it cannot use silently — the author has to be told at build time or
  never.
- **The catalog flag is generic.** `multiple: true` on a catalog input means "a
  set of `choices`", typed `t.list(t.string)`. Nothing about it is notify-specific;
  only the option titles and availability are.

## Shape

Catalog (`packages/workflows`):

- `ActionInputLike` / `BuiltActionInput` / `CatalogInput` gain `multiple?: boolean`,
  and `defaultValue` widens to `string | readonly string[]`.
- `notify` gains `channels: { type: t.list(t.string), choices: ["inApp","email","slack"],
  multiple: true, defaultValue: ["inApp","email"], required: false }`.
- `checkInputs` validates every member of a list literal against `choices`
  (today it only checks single strings).
- `validateCatalogInputs` refuses a `multiple` input that is not a list of strings
  with `choices`, and checks an array `defaultValue` member by member.

Builder (`apps/erp`):

- `MultiChoiceField` — a fourth field component, dispatched in `ActionForm`
  alongside `pairs` and `template`. Renders `ChoiceSelect multiple`.
- `multiChoice.ts` — the pure value round-trip (`readChoices` / `writeChoices`),
  unit-tested; an emptied set stores as absent, matching `pairsRows.ts`.
- `choiceOptions.tsx` — resolves `choices` to titles/descriptions/disabled. Reads
  availability from `useIntegrations().has("slack")` and
  `usePlanGate({ feature: "EMAIL_NOTIFICATIONS" })`, both of which read the `/x`
  layout's route data — no loader change.

Runtime (`packages/jobs`):

- `runNotifyAction` reads `inputs.channels`, keeps the values that are real
  `NotificationDestination`s, and passes them as `destinations`. Empty or absent
  omits the field, so the job's default map still applies.

## Not doing

- Letting the author switch off in-app. That would change delivery for every
  notification type in the product, not just workflows.
- Warning at run time when a channel was skipped. The job's silence is
  pre-existing; the build-time disable is the fix that reaches the author.
