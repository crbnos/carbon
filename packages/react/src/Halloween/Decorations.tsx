// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getLogger } from "@carbon/logger";
import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { BarSpider } from "./BarSpider";
import { BooGhost } from "./Ghost";
import { HalloweenStyles } from "./HalloweenStyles";
import { Optional } from "./Optional";
import { BatFlyby, SuccessBats } from "./Visitors";

// The app shell's decorations. Its own chunk, loaded by `HalloweenLayer` only
// while the theme is on, so the rest of the year no shell downloads it.

const log = getLogger("react", "halloween");

const loadReveal = () => import("./HalloweenReveal");
const HalloweenReveal = lazy(loadReveal);

function preloadReveal() {
  loadReveal().catch((error) => {
    log.error("Halloween reveal failed to preload", { error });
  });
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
          // Its own net: a failed reveal closes, and the rest keep running.
          <Optional key="halloween-reveal" onError={close}>
            <Suspense fallback={null}>
              <HalloweenReveal onClose={close} />
            </Suspense>
          </Optional>
        )}
      </AnimatePresence>
    </>
  );
}
