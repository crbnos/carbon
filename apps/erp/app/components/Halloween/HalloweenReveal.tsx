// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, useEscape } from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { HalloweenScene, NIGHT } from "./HalloweenScene";

// The surprise behind the spider web, over the whole screen. It closes on its
// own, on Escape, or on a click anywhere.

const AUTO_CLOSE_MS = 10_000;

export default function HalloweenReveal({
  onClose,
  onHide
}: {
  onClose: () => void;
  onHide: () => void;
}) {
  const { t } = useLingui();
  const still = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEscape(onClose);

  useEffect(() => {
    closeRef.current?.focus();
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal
      aria-label={t`Happy Halloween`}
      className="fixed inset-0 z-[100] cursor-pointer select-none overflow-hidden"
      style={{ backgroundColor: NIGHT }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: still ? 0.2 : 0.6, ease: "easeOut" }}
      onClick={onClose}
    >
      <HalloweenScene
        title={t`Happy Halloween`}
        subtitle={t`Something wicked this way ships.`}
        still={still}
      />

      <motion.div
        className="absolute inset-x-0 bottom-10 flex justify-center gap-2"
        initial={still ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 2.4 }}
        onClick={(event) => event.stopPropagation()}
      >
        <Button ref={closeRef} variant="secondary" onClick={onClose}>
          <Trans>Close</Trans>
        </Button>
        <Button
          variant="ghost"
          className="text-white/80 hover:bg-white/10 hover:text-white"
          onClick={onHide}
        >
          <Trans>Hide decorations</Trans>
        </Button>
      </motion.div>
    </motion.div>,
    document.body
  );
}
