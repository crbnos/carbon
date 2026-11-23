// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, HStack, LabelWithHelp } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import PlaybackRow from "./AssemblyPlaybackRow";
import type { CameraControls } from "./useStepMotionEditor";

/**
 * A planner hint (`{ source: "plan" }`) is not a saved view: it reads as
 * Automatic and offers no Clear.
 */
export default function AssemblyCameraRow({
  stepId,
  hasSavedView,
  isDisabled,
  camera
}: {
  stepId: string;
  hasSavedView: boolean;
  isDisabled: boolean;
  camera: CameraControls;
}) {
  return (
    <PlaybackRow
      label={
        <LabelWithHelp termId="assembly-step-camera" variant="inline">
          <Trans>Camera</Trans>
        </LabelWithHelp>
      }
      value={
        hasSavedView ? <Trans>Saved view</Trans> : <Trans>Automatic</Trans>
      }
    >
      {!isDisabled && (
        <HStack spacing={1}>
          {hasSavedView && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => camera.onClear(stepId)}
            >
              <Trans>Clear</Trans>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => camera.onSet(stepId)}
          >
            <Trans>Use Current View</Trans>
          </Button>
        </HStack>
      )}
    </PlaybackRow>
  );
}
