---
paths: ["packages/documents/src/template/texts/**"]
triggers: ["documentTemplate", "documentEdit"]
promoted: null
---
# A catalog default holding a variable changes what a stored word means

- **Context:** document texts store only the words a user changed, keyed by catalog key.
- **Problem:** when a key's default goes from `Date:` to `Date: {order.date}`, a stored `Order date:` keeps the key and prints no value, because the block no longer adds it.
- **Rule:** before moving a value into a catalog default, confirm no stored row holds that key. If one can, migrate the stored words too. Nothing checks a default's variables except `texts.test.ts`, so keep it passing.
- **Applies to:** `packages/documents/src/template/texts/`, `documentTemplate`, `documentEdit`.
