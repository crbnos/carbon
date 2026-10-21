// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AnimatePresence } from "motion/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { BarSpider } from "./BarSpider";
import { BooGhost } from "./Ghost";
import { HalloweenStyles } from "./HalloweenStyles";
import { useHalloween } from "./season";
import { BatFlyby, SuccessBats } from "./Visitors";

// Seasonal decoration, shared by the ERP and the MES (`@carbon/react/Halloween`).
// Everything renders only while the Halloween theme is on (`useHalloween`,
// season.ts); for everyone else this returns nothing.
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
//      (forced for everyone, its mesh colors), so nothing reads it by name.
//   4. Run `pnpm run lingui:extract` to drop its strings from the catalogs.
// Typecheck flags any mount or import left behind. The `data-user-menu`,
// `data-date` and `data-app-card` attributes the styles hang off, and
// `relative` on the sign-in logos, do nothing on their own and can stay.

const loadReveal = () => import("./HalloweenReveal");
const NightShift = lazy(() => import("./night-shift/NightShift"));
const HalloweenReveal = lazy(loadReveal);

function preloadReveal() {
  void loadReveal();
}

export function HalloweenLayer() {
  const on = useHalloween();
  if (!on) return null;
  return <Decorations />;
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

  // The scene is night in either mode, so the panel it fills goes dark: its
  // logo and headline take their dark variants. Undone on unmount.
  useEffect(() => {
    const panel = ref.current?.parentElement;
    if (!panel || panel.classList.contains("dark")) return;
    panel.classList.add("dark");
    return () => panel.classList.remove("dark");
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <Suspense fallback={null}>
        <NightShift />
      </Suspense>
      {/* Keeps the panel's headline readable over the fog. */}
      <div className="absolute inset-x-0 bottom-0 z-10 h-64 bg-gradient-to-t from-black/75 via-black/40 to-transparent" />
    </div>
  );
}

function Decorations() {
  const [revealOpen, setRevealOpen] = useState(false);
  const open = useCallback(() => setRevealOpen(true), []);
  const close = useCallback(() => setRevealOpen(false), []);

  return (
    <>
      <HalloweenStyles />
      {createPortal(
        <div aria-hidden className="halloween-fog" />,
        document.body
      )}
      <BarSpider
        revealOpen={revealOpen}
        onOpen={open}
        onPreload={preloadReveal}
      />
      <BatFlyby />
      <SuccessBats />
      <BooGhost />
      <AnimatePresence>
        {revealOpen && (
          <Suspense key="halloween-reveal" fallback={null}>
            <HalloweenReveal onClose={close} />
          </Suspense>
        )}
      </AnimatePresence>
    </>
  );
}
