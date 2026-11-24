---
paths: []
triggers: []
promoted: null
---
# Twin `ValidatedForm`s at the same JSX slot share one RVF store — controlled-field defaults seed only for whichever branch mounts first

**Context:** The Add Affected Item modal (`AffectedItemForm`) renders `isNewPart ? <ValidatedForm A/> : <ValidatedForm B/>`. Branch A (New Part) has `replenishmentSystem`/`itemTrackingType` Selects with `defaultValues` `"Make"`/`"Inventory"`; branch B (existing item) has an item picker. After switching to New Part the two Selects rendered blank and submit failed with `Invalid enum value … received ''`.

**Problem:** Both branches render a `<ValidatedForm>` (same element type) at the **same JSX position**, so React reconciles them as **one component instance** and just swaps props — no unmount/remount. `@carbon/form`'s RVF store seeds `controlledFields.values` from `defaultValues` **only on first hydration** (`syncFormProps`: `if (!state.isHydrated) { … }`). The instance hydrates on the initial branch (B, `changeType` default `Version`), so when the user switches to A, A's Select defaults are **never** seeded — `useControlledFieldValue` returns the store value (`undefined`) once `isHydrated`, not the `defaultValue`. Uncontrolled fields (`InputControlled`) were unaffected because they write their own value via effect. `defaultValues` object identity was a red herring: `ValidatedForm` already `useDeepEqualsMemo`s it, and `syncFormProps` ignores later `defaultValues` changes post-hydration.

**Rule:** When two `ValidatedForm`s occupy the same conditional slot (`cond ? <VF/> : <VF/>`), give each a distinct, stable `key` (`key="new-part"` / `key="existing-item"`) so switching forces a fresh mount + fresh store that hydrates with the correct branch's `defaultValues`. Consequence: the fresh mount also needs any Select value the branch relies on seeded in its own `defaultValues` (e.g. `changeType: "New Part"`, added to `changeOrderNewPartValidator`) — a value the shared store previously carried over from the user's click is gone after remount. Symptom to watch for: a controlled Select rendering blank / submitting `""` right after a branch switch.

**Applies to:** `apps/erp/app/modules/items/ui/ChangeOrder/AffectedItemForm.tsx`; any conditional twin-`ValidatedForm` pattern; `@carbon/form` controlled fields (`Select`/`Combobox`/anything on `useControlField`) that rely on `defaultValues` seeding.
