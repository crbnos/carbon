---
paths: []
triggers: []
promoted: null
---
# A tagged `t` only works in the component that called `useLingui`

- **Context:** a helper took `t` as a parameter and used it as a tagged template.
- **Problem:** the Lingui macro transforms `t` only where `useLingui` binds it. Typecheck passes, but `extract` drops the message and the call receives a template array at runtime.
- **Rule:** keep the tagged `t` in the component or a closure inside it. Pass finished strings to helpers. If a new message is missing after `lingui:extract`, look for this first.
- **Applies to:** every `t` passed through a function parameter.
