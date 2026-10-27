// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { lazy, Suspense } from "react";
import { Optional } from "./Optional";
import { useHalloween } from "./season";

// Seasonal decoration, shared by the ERP and the MES (`@carbon/react/Halloween`).
// Everything renders only while the Halloween theme is on (`useHalloween`,
// season.ts); for anyone else, and on any other day, this returns nothing.
// The days are `available` in packages/utils/src/halloween-theme.ts.
//
// To remove Halloween, the theme and every decoration:
//   1. Delete this folder and the `./Halloween` export in
//      packages/react/package.json.
//   2. Delete the two mounts and their imports: `<HalloweenLayer />` in the
//      ERP's and the MES's routes/x+/_layout.tsx.
//   3. Delete packages/utils/src/halloween-theme.ts, its export in
//      packages/utils/src/index.ts and its entry in `seasonalThemes`
//      (packages/utils/src/themes.ts). The theme carries everything else
//      (its day, its mesh colors), so nothing reads it by name.
//   4. Delete the doc lines that name them: the Halloween paragraphs of
//      .claude/rules/coding-conventions.md (Theme System), the "Seasonal
//      decorations" bullet of packages/react/AGENTS.md and
//      `halloween-theme.ts` in packages/utils/AGENTS.md.
//   5. Run `pnpm run lingui:extract` to drop its strings from the catalogs.
// Typecheck flags any mount or import left behind. The `data-user-menu`,
// `data-date` and `data-app-card` attributes the styles hang off do nothing
// on their own and can stay.

// This file is all the shells import, so it stays small: everything else
// loads in its own chunk, and only while the theme is on.
const Decorations = lazy(() => import("./Decorations"));

export function HalloweenLayer() {
  const on = useHalloween();
  if (!on) return null;
  return (
    <Optional>
      <Suspense fallback={null}>
        <Decorations />
      </Suspense>
    </Optional>
  );
}
