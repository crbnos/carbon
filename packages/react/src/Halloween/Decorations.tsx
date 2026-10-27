// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { BarSpider } from "./BarSpider";
import { BooGhost } from "./Ghost";
import { HalloweenStyles } from "./HalloweenStyles";
import { BatFlyby, SuccessBats } from "./Visitors";

// The app shell's decorations. Its own chunk, loaded by `HalloweenLayer` only
// while the theme is on, so the rest of the year no shell downloads it.

const loadReveal = () => import("./HalloweenReveal");
const HalloweenReveal = lazy(loadReveal);

function preloadReveal() {
  void loadReveal();
}

export default function Decorations() {
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
