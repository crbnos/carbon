// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Button } from "../Button";
import { HalloweenScene } from "./HalloweenScene";
import { NIGHT } from "./scene-palette";

// The surprise behind the spider web, over the whole screen. It closes on its
// own, on Escape, or on a click anywhere. A Radix dialog, so focus stays in it
// and goes back where it was when it closes; mounted only while open (the
// caller's AnimatePresence plays the fade out).

const AUTO_CLOSE_MS = 10_000;

export default function HalloweenReveal({ onClose }: { onClose: () => void }) {
  const { t } = useLingui();
  const still = useReducedMotion() ?? false;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal forceMount>
        <DialogPrimitive.Content
          asChild
          forceMount
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
        >
          <motion.div
            className="fixed inset-0 z-[100] cursor-pointer select-none overflow-hidden"
            style={{ backgroundColor: NIGHT }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: still ? 0.2 : 0.6, ease: "easeOut" }}
            onClick={onClose}
          >
            <DialogPrimitive.Title className="sr-only">
              {t`Happy Halloween`}
            </DialogPrimitive.Title>
            <HalloweenScene title={t`Happy Halloween`} still={still} />

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
            </motion.div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
