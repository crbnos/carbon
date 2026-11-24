---
paths: ["apps/erp/app/components/Form/TaxFields.tsx"]
triggers: ["formatOptions", "NumberControlled", "EditableNumberCell", "INPUT_FORMAT"]
promoted: null
---
# react-aria's blur commit makes the input formatter part of arithmetic

**Context:** The numeric-precision standard's motivating bug — a user typed 6.25% tax, saved, reopened, and read 6.22%.

**Problem:** react-aria NumberField commits on blur by running `parse(format(value))` — whatever `formatOptions` the input carries re-rounds the committed number. A currency-formatted amount input rounds to cents on blur; the old bidirectional tax pair (amount edit → percent = amount/subtotal, percent edit → amount = subtotal×percent) then overwrote the typed 6.25% with 0.56/9.00 = 6.22%. Nothing in zod, the column type, or the service was wrong — the INPUT FORMATTER did the rounding, and the coupling propagated it.

**Rule:** Editable numeric inputs must use the named `INPUT_FORMAT.*` kinds from `@carbon/utils` (rate max 3 percent-digits, quantity max 5, money/price at the currency's decimals) so the blur round-trip preserves the stored scale. **Round a derived value to the scale of the field that will hold it BEFORE putting it there** — that is the actual fix. An unrounded 0.5625 in a cents-formatted input is re-committed as 0.56 on blur, which registers as a genuine change and feeds back through any coupling; a value derived through `applyRate` at the currency's decimals commits identically and triggers nothing. With that in place a value pair can safely stay coupled in both directions (`TaxFields` does, so the stored pair is always consistent), accepting that a rate derived back from an amount is limited by the amount's scale. When an input's digits look like a display preference, remember they are arithmetic on the persisted value.

**Applies to:** every `formatOptions` on an editable `NumberField`/`NumberControlled`/`EditableNumberCell`; `apps/erp/app/components/Form/TaxFields.tsx`; `.claude/rules/numeric-precision.md`; the `no-inline-fraction-digits` conformance check.
