// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Optional } from "./Optional";
import { useHalloween } from "./season";

// Seasonal decoration, shared by the ERP and the MES (`@carbon/react/Halloween`).
// Everything renders only on Halloween, when the theme is on for everyone
// (`useHalloween`, season.ts); on any other day this returns nothing. The
// day is `available` in packages/utils/src/halloween-theme.ts.
//
// To remove Halloween, the theme and every decoration:
//   1. Delete this folder and the `./Halloween` export in
//      packages/react/package.json.
//   2. Delete the three mounts and their imports: `<HalloweenLayer />` in the
//      ERP's and the MES's routes/x+/_layout.tsx, `<HalloweenLoginArt />` in
//      the ERP's routes/_public+/_layout.tsx.
//   3. Delete packages/utils/src/halloween-theme.ts, its export in
//      packages/utils/src/index.ts and its entry in `seasonalThemes`
//      (packages/utils/src/themes.ts). The theme carries everything else
//      (its day, its mesh colors), so nothing reads it by name.
//   4. Delete the doc lines that name them: the Halloween paragraphs of
//      .claude/rules/coding-conventions.md (Theme System), the "Seasonal
//      decorations" bullet of packages/react/AGENTS.md (keep its last
//      sentence) and `halloween-theme.ts` in packages/utils/AGENTS.md.
//   5. Run `pnpm run lingui:extract` to drop its strings from the catalogs.
// Typecheck flags any mount or import left behind. The `data-user-menu`,
// `data-date` and `data-app-card` attributes the styles hang off, and
// `relative` on the sign-in logos, do nothing on their own and can stay.

// This file is all the shells import, so it stays small: everything else
// loads in its own chunk, and only while the theme is on.
const Decorations = lazy(() => import("./Decorations"));
const NightShift = lazy(() => import("./night-shift/NightShift"));

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

/**
 * The Night Shift, the ASCII story on the sign-in page's left panel. Fills
 * its positioned parent; the engine loads only while the theme is on.
 */
export function HalloweenLoginArt() {
  const on = useHalloween();
  if (!on) return null;
  return <LoginArt />;
}

function LoginArt() {
  const ref = useRef<HTMLDivElement>(null);
  // The panel is hidden on narrow screens: the engine loads and runs only
  // while it is shown.
  const [shown, setShown] = useState(false);

  // The scene is night in either mode, so the panel it fills goes dark: its
  // logo and headline take their dark variants. Undone on unmount.
  useEffect(() => {
    const panel = ref.current?.parentElement;
    if (!panel) return;
    const darkened = !panel.classList.contains("dark");
    if (darkened) panel.classList.add("dark");
    const resized = new ResizeObserver(([entry]) => {
      setShown((entry?.contentRect.width ?? 0) > 0);
    });
    resized.observe(panel);
    return () => {
      resized.disconnect();
      if (darkened) panel.classList.remove("dark");
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {shown && (
        <Optional>
          <Suspense fallback={null}>
            <NightShift />
          </Suspense>
        </Optional>
      )}
      {/* Keeps the panel's headline readable over the fog. */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/75 via-black/40 to-transparent" />
    </div>
  );
}
