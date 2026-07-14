# Specs — Agent Rules

Check `.ai/specs/` before modifying any module. Create or update specs when the change is non-trivial.

## Always

- Check specs directory before modifying a module or adding a feature.
- Create a new spec for new modules, significant features, or architecture changes touching multiple files.
- Update an existing spec when changing APIs, data models, workflows, or cross-module behavior.
- Keep specs implementation-accurate and update the changelog after implementation.

## Ask First

- Ask before moving a spec to `implemented/` if deployment/completion evidence is incomplete.
- Ask before changing the spec directory structure or naming convention.

## Never

- Never leave stale endpoints, entities, or assumptions in an updated spec.
- Never skip the spec for changes that affect multiple modules or change data models.

## Spec Lifecycle

```
1. Idea → research + design decisions; open questions collected
2. Open questions resolved with the user (hard stop — BEFORE the spec is written)
3. Spec written in .ai/specs/{YYYY-MM-DD}-{title}.md with resolutions baked in
   (questions surfaced while writing go back to step 2 before the spec is final)
4. Implementation proceeds phase-by-phase
5. Completed spec moves to .ai/specs/implemented/
6. PR links back to spec via "Tracking spec:" line
```

## File Naming Convention

```
{YYYY-MM-DD}-{kebab-case-title}.md
```

Examples:
- `2026-07-01-eco-workflow-overhaul.md`
- `2026-07-05-lot-traceability-receipts.md`

## Create/Update Triggers

| Trigger | Action |
|---------|--------|
| New module | Create spec |
| Feature touching 3+ files | Create spec |
| Data model change | Create or update spec |
| API contract change | Update spec |
| Cross-module behavior change | Create spec |
| Small bug fix or typo | Skip spec |
| One-file refactor, no behavior change | Skip spec |

## Spec Template

Use `.ai/specs/template.md` as a starting point for new specs.
