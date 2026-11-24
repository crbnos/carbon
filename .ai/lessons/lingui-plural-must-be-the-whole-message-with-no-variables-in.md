---
paths: []
triggers: []
promoted: null
---
# Lingui `plural()` must be the whole message, with no variables in its branches

**Context:** Accessibility labels like "3 jobs for SO000001, in progress" were written as `` t`${plural(n, { one: "# job for", other: "# jobs for" })} ${orderId}` `` and later with `${orderId}` inside the branches.

**Problem:** The macro only folds `plural()` into the ICU message when it is the entire `t` template and its branches are plain strings. Text around it, or template variables inside a branch, leave `plural()` to run at render through Lingui's global instance, which has no active locale on the server — the whole route throws ("Attempted to call a translation function without setting a locale"). Typecheck and unit tests pass; only rendering the cell shows it.

**Rule:** Use `` t`${plural(n, { one: "# job", other: "# jobs" })}` `` with literal branches and nothing else in the template, or phrase the string so the count needs no agreement (`` t`Jobs for ${orderId}: ${n}` ``). Load the page after adding any `plural()`.

**Applies to:** every `plural()` / `select()` from `@lingui/core/macro` inside `t`/`msg`, especially in table cell renderers.
