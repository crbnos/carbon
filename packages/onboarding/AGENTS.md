# @carbon/onboarding

Implementation Hub — the seven-phase journey to activation (Tell Us How You Run → Live on Carbon): content templates, pure logic, server DB helpers, and presentational UI.

## Always

- **Use the four-export structure**: `@carbon/onboarding` (content + logic + types, client-safe), `@carbon/onboarding/server` (DB helpers), `@carbon/onboarding/ui` (React components), `@carbon/onboarding/engine` (macro-free slice for `@carbon/jobs` — NO Lingui in its import graph; gate titles there are plain English strings for transactional email).
- **Follow Carbon service convention** — server functions take supabase client as first arg, return `{ data, error }` (never throw)
- **Keep logic pure and client-safe** — `src/logic/` contains visibility, timeline, board, guide, overlay, tailor (intake → plan), diffIntake (re-tune summaries), intakeRows (versioned answer snapshots), and streak (Duolingo mechanics) with no server deps
- **Use zustand for UI state** — `hubStore` manages the Implementation Hub's client-side state via `HubProvider`
- **Receipts are part of the contract** — anything the tailoring hides must carry a one-line "because you said…" wherever it would have appeared; if it can't explain itself, mark it Later instead
- **Authority order** — observed product state > confirmed decision > intake answer (tailorPlan suppresses hides that contradict reality and raises a conflict instead)

## Ask First

- Modifying the `TEMPLATE_KEY` or `TEMPLATE_VERSION` constants (bumping the version RESETS every enrolled hub lazily via the get-started layout loader)
- Adding new DB tables or columns (per-company state deliberately lives in the existing `implementationRow` collections / `implementationFieldValue` keys — the sanctioned extension stores)
- Changing the onboarding step ordering or visibility logic
- Renaming any persisted key (step keys, question keys, collection names, field-key prefixes — keys are forever)

## Never

- Import server-only modules (`@supabase/supabase-js`, DB client) from the client-safe barrel export
- Import anything Lingui-touching from `engine.ts`'s graph (jobs has no macro transform; it crashes at module load)
- Hardcode company-specific setup steps — use the template/content system

## Validation Commands

```bash
pnpm --filter @carbon/onboarding test        # vitest (tailor/diff/streak suites)
pnpm --filter @carbon/onboarding typecheck   # tsgo --noEmit
```

## Key Patterns

- **Content-driven**: `src/content/` defines the template — `spine.ts` (the 7 gates, all tiers; `GO_LIVE_STEP_KEY` = the switch gate), `intake.ts` (the 17 questions + flags), `decisions.ts` (the five decisions), `recipes.ts` (per-source Load Your Data steps), `pilot.ts` (the self-verifying trace), `crew.ts` (champions + floor rollout), `switchplan.ts` (T-minus, freeze plan, huddle), `setup.ts`, `registry.ts` (pages; `lockedPreviewFor` = out-of-tier pages shown as locked previews), `collections.ts` (custom-row surfaces; `customerAdd` lets customers create rows — enforced by the /state action), `support.ts` (booking URL + Guided moment cards)
- **Per-company state**: intake answers = versioned snapshot rows in collection `intake` (latest completed wins; drafts are resumable; transcripts in `intakeTranscript` for sales review); usage days in `usageDay`; streak/live markers + customer-owned fill-ins in `implementationFieldValue` (see `isCustomerEditableField` in models.ts for what customers may write)
- **Signals**: `detectImplementationSignals` (server.ts) probes 15 tables; `NO_SIGNALS` is the single all-false source; manual check-state overrides always win
- **UI**: views read the store via hooks (`useTailoring`, `useIntakeState`, `useCounts`, `useResolveRecordUrl`…); `IntakeWizard`/`PayoffScreen` take injected async callbacks (transcribe/clarify/upload) from the route

## Cross-References

- `packages/database/` — `implementationHub`, `implementationCheckState`, `implementationFieldValue`, `implementationRow` tables (no schema changes since `20260624140312`)
- `packages/jobs/src/inngest/functions/scheduled/implementation.ts` — the activation engine, Monday digest, and quiet-detection crons (consume `./engine`)
- `packages/documents/src/email/HubJourneyEmails.tsx` — trophy/digest/nudge templates
- `apps/erp/app/routes/x+/get-started+/` — routes, wizard wiring, First Win, opening stock, fleet view
- `.ai/plans/2026-07-21-implementation-hub-phase-2.md` — the phase-2 design record
