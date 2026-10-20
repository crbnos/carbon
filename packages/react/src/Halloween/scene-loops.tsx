// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { SVGProps } from "react";
import { createContext, useContext } from "react";

// Shared by everything in the Halloween scene. Staged entrances use motion;
// the endless loops (twinkling, flickering, flapping, drifting) are SMIL,
// which the browser runs without any script.

/**
 * Animate an SVG group around its own local origin. The default fill-box
 * origin is the middle of whatever the group holds, which moves while the
 * parts inside it (a bat's wings, a pumpkin's cackling mouth) animate.
 */
export const SCENE_ORIGIN = {
  transformBox: "view-box",
  // motion's own origin props: it drops a plain transformOrigin and writes
  // 50% 50%, which with a view-box box is the middle of the screen.
  originX: "0px",
  originY: "0px"
} as const;

/** With reduced motion the scene stands still: no loops at all. */
export const StillContext = createContext(false);

export function useStill() {
  return useContext(StillContext);
}

export function Loop(props: SVGProps<SVGAnimateElement>) {
  const still = useStill();
  return still ? null : <animate repeatCount="indefinite" {...props} />;
}

export function LoopTransform(props: SVGProps<SVGAnimateTransformElement>) {
  const still = useStill();
  return still ? null : (
    <animateTransform
      attributeName="transform"
      repeatCount="indefinite"
      {...props}
    />
  );
}
