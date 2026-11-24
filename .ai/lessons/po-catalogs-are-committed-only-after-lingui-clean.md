---
paths: ["packages/locale/locales/**/*.po"]
triggers: ["lingui:extract", "lingui:clean"]
promoted: null
---
# `.po` catalogs are committed only after `lingui:clean`

**Context:** `pnpm run lingui:extract` alone leaves `#: path:line` origin comments and a
`POT-Creation-Date` header in all 26 catalogs — 170k diff lines for ~30 real strings.

**Rule:** always `pnpm run lingui:extract && pnpm run lingui:clean` (or `pnpm run translate`);
the commit hook normalises, but the working tree should never carry the noise.
