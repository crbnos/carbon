// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { BarSpider } from "./BarSpider";
import { BooGhost } from "./Ghost";
import { HalloweenStyles } from "./HalloweenStyles";
import { useHalloween } from "./season";
import { BatFlyby, SuccessBats } from "./Visitors";

// Seasonal decoration, shared by the ERP and the MES (`@carbon/react/Halloween`).
// Everything renders only while the user has the Halloween theme on
// (`useHalloween`, season.ts); for everyone else this returns nothing.
//
// To remove it: delete this folder, the `./Halloween` export in
// packages/react/package.json and the `<HalloweenLayer />` mount in each app
// shell (ERP routes/x+/_layout.tsx, MES routes/x+/_layout.tsx). The
// `data-user-menu` and `data-date` attributes it styles do nothing on their
// own and can stay.

const loadReveal = () => import("./HalloweenReveal");
const HalloweenReveal = lazy(loadReveal);

function preloadReveal() {
  void loadReveal();
}

export function HalloweenLayer() {
  const on = useHalloween();
  if (!on) return null;
  return <Decorations />;
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
