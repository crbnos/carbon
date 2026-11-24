---
paths: ["packages/react/src/Card.tsx", "packages/onboarding/src/ui/primitives/Section.tsx"]
triggers: ["<CardContent", "dark:bg-card"]
promoted: null
---
# The design-system `Card` is a gray tray + shadow edge — the white surface is `CardContent`, and a tint on the shell needs a `dark:` variant

**Context:** Building card surfaces with `@carbon/react`'s `Card` family (`packages/react/src/Card.tsx`), e.g. the onboarding Implementation Hub (`packages/onboarding/src/ui/**`). Three separate traps hit in sequence while converting hand-rolled `rounded-lg border bg-card` blocks to the design system.

**Problem:**
1. `Card` is `bg-accent dark:bg-card` — a **muted gray tray** in light mode, not a white card. Putting content directly in `<Card>` reads gray. The white surface (`bg-card`) comes from `CardContent`; the canonical composition is `Card > CardHeader + CardContent` (see `MetricCard.tsx`, `ActionTaskList.tsx`).
2. `Card`'s `shadow-button-base` already draws the crisp outer edge (a `0 0 0 1px` ring + inset highlights). A `CardContent` `border` sitting on top of that shadow ring reads as a **blurry double line**.
3. Overriding the shell background with an **un-prefixed** color (`bg-emerald-500/5`) leaves `Card`'s base `dark:bg-card` in the class list; `.dark .dark:bg-card` out-specifies `.bg-emerald-500/5`, so the tint **silently disappears in dark mode** (border/icon still show, so it degrades quietly).

**Rule:**
- Single-surface white card: `Card > CardContent` (not content directly in `Card`).
- Titled card: heading in `CardHeader` over `CardContent`; the shell shadow is the outer edge, so use `CardContent className="border-0"` and put the header/body divider on the `CardHeader` (`border-b border-border`) — never a full `CardContent` border on top of the shadow.
- Colored callout on a `Card`: always pair the tint with its `dark:` variant (`bg-emerald-500/5 dark:bg-emerald-500/5`). `cn`/twMerge then drops the base `dark:bg-card`. Verify by checking the rendered class list no longer contains `dark:bg-card`.

**Applies to:** any UI composing `@carbon/react` `Card`/`CardContent`/`CardHeader`; the `Section`/`Panel` primitives in `packages/onboarding/src/ui/primitives/Section.tsx` centralize this composition for the hub.
