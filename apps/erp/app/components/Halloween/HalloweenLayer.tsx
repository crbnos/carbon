// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { AnimatePresence } from "motion/react";
import { lazy, Suspense, useCallback, useState } from "react";
import { BarSpider } from "./BarSpider";
import { hideDecorations, useHalloweenDecorations } from "./season";

// Seasonal decoration. To remove it, delete this folder, its mount in
// routes/x+/_layout.tsx and the pumpkin home icon in
// components/Layout/Topbar/Breadcrumbs.tsx. Until then it switches itself on
// and off with the season (season.ts).

const loadReveal = () => import("./HalloweenReveal");
const HalloweenReveal = lazy(loadReveal);

function preloadReveal() {
  void loadReveal();
}

export function HalloweenLayer({ userId }: { userId: string }) {
  const shown = useHalloweenDecorations(userId);
  const [revealOpen, setRevealOpen] = useState(false);

  const open = useCallback(() => setRevealOpen(true), []);
  const close = useCallback(() => setRevealOpen(false), []);
  const hide = useCallback(() => {
    setRevealOpen(false);
    hideDecorations(userId);
  }, [userId]);

  return (
    <>
      {shown && (
        <BarSpider
          revealOpen={revealOpen}
          onOpen={open}
          onPreload={preloadReveal}
        />
      )}
      <AnimatePresence>
        {revealOpen && (
          <Suspense key="halloween-reveal" fallback={null}>
            <HalloweenReveal onClose={close} onHide={hide} />
          </Suspense>
        )}
      </AnimatePresence>
    </>
  );
}
