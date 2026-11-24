---
paths: []
triggers: []
promoted: null
---
# A Lingui placeholder is named after its expression, so a refactor can silently drop translations

**Context:** Strict backflush (2026-10-16) changed `<Plural value={methodsMissingPullFrom} …>` to `<Plural value={gaps.methods} …>`.

**Problem:** A member expression has no name, so the message id changed from `{methodsMissingPullFrom, plural, …}` to `{0, plural, …}`. `lingui:extract --clean` then deleted the old id and its 12 translations, and the new id came back untranslated.

**Rule:** Pass a plain, named variable to `Plural`, `t` and `Trans` placeholders, and keep the name when refactoring. If extract drops translations by mistake, restore the catalogs from git (`git checkout HEAD -- packages/locale/locales`), fix the name, and extract again.

**Applies to:** every `Plural` / `t\`…${x}\`` / `<Trans>` with an interpolation.
