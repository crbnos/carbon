---
paths: []
triggers: []
promoted: null
---
# Lingui: a string literal with braces inside `<Trans>` loses its braces

**Context:** The sequence forms' week year warning named the tokens in its text: `<Trans>On 1 January 2027 {"%{yy}%{ww}"} gives 2753.</Trans>`.

**Problem:** Lingui inlines a string literal expression into the message, so the msgid became `On 1 January 2027 %{yy}%{ww} gives 2753.` The braces then parse as ICU placeholders `{yy}` and `{ww}` with no value, and the page showed "On 1 January 2027 %% gives 2753." Typecheck, Biome and `lingui:extract` all pass.

**Rule:** Text that contains `{` or `}` goes into `<Trans>` or `t` as a named variable (`const token = "%{yy}"; … {token}`), which Lingui keeps as a placeholder and fills at runtime. Read the rendered text once after adding such a string.

**Applies to:** any `<Trans>` or `` t` ` `` that quotes sequence tokens, template syntax or JSON.
