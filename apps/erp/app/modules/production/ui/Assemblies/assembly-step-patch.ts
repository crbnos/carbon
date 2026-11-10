// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { CameraPose, Motion, Quat } from "@carbon/viewer";

/**
 * Body for `assemblyInstructionStepMotionValidator`: an `undefined` field is not
 * sent, so the route leaves that column as it is; `null` clears it.
 */
export function stepPatchFormData(patch: {
  motion?: Motion;
  camera?: CameraPose | null;
  orientation?: Quat | null;
  reset?: boolean;
}): FormData {
  const formData = new FormData();
  if (patch.reset) formData.set("reset", "on");
  if (patch.motion !== undefined) {
    formData.set("motion", JSON.stringify(patch.motion));
  }
  if (patch.camera !== undefined) {
    formData.set("camera", JSON.stringify(patch.camera));
  }
  if (patch.orientation !== undefined) {
    formData.set("orientation", JSON.stringify(patch.orientation));
  }
  return formData;
}
