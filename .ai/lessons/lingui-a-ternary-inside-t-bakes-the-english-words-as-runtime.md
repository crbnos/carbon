---
paths: []
triggers: ["=== 1 ? \"", "<Plural", "plural("]
promoted: null
---
# Lingui: a ternary inside t`` bakes the English words as runtime values

**Context:** Building the quote lead-time modal, plural labels were written as
`` t`${days} ${days === 1 ? "day" : "days"}` `` and
`` t`${n} ${n === 1 ? "operation has" : "operations have"} no time standards` ``.

**Problem:** Lingui extracts that as `{0} {1} no time standards` — the "day"/
"days"/"operation has"/"operations have" strings are computed at runtime and
passed in as PLACEHOLDER VALUES, never as translatable text. So every locale's
`msgstr` still contains the English word, `linguito check` stays green (nothing
is "missing"), and a French user reads "5 days", not "5 jours". The defect is
invisible to the missing-translation gate because the placeholder IS filled.

**Rule:** Never put a pluralizing (or any word-choosing) ternary inside a
`t` tagged template or `<Trans>`. Use the ICU plural macro: `<Plural value={n}
one="# day" other="# days" />` from `@lingui/react/macro` (or `plural()` in
non-JSX — but not inside a `memo(…)`-wrapped component, see "Lingui: `plural()`
inside a `memo(…)` component calls the global i18n" below). The whole phrase
with `#` goes in each branch
(`one="# operation has no time standards"`), so the words are extracted and
translated. After adding one, re-run `lingui:extract` + `/translate` — the new
ICU msgid needs its own filled `msgstr` per locale (locales with more CLDR
categories, e.g. Polish/Russian `few`/`many`, get the extra branches).

**Applies to:** any `apps/{erp,mes}/app` or `packages/{react,form}/src` string
with a count-dependent word; grep `? "` inside `` t` `` templates when reviewing
i18n.
