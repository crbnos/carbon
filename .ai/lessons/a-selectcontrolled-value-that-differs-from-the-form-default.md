---
paths: ["packages/form/src/components/SelectControlled.tsx"]
triggers: ["SelectControlled"]
promoted: null
---
# A `SelectControlled` value that differs from the form default is cleared on mount

**Context:** A `SelectControlled` whose `value` prop comes from component state (`useState(canEmail ? "Email" : "None")`) inside a `ValidatedForm` whose `defaultValues` hold another value (`"None"`), both mounting together (the quote-to-order confirm step, TCK-55).

**Problem:** `SelectControlled` copies `value` into the form field in an effect right after mount. Radix Select then sets its hidden native `<select>` to the new value before that `<select>` has its `<option>`s, reads back `""`, and fires `onValueChange("")`, which writes `""` into the field. The trigger shows blank, the form posts `""`, and a `z.enum([...]).optional()` validator refuses it ("Invalid option"), so Convert silently did nothing whenever the company had Email set up.

**Rule:** Give the form the value the select starts with: `defaultValues[name]` must equal the `SelectControlled` `value` on its first render. Derive both from the same source; never let the default and the state disagree.

**Applies to:** every `SelectControlled` driven by local state or a derived value (`packages/form/src/components/SelectControlled.tsx`).
