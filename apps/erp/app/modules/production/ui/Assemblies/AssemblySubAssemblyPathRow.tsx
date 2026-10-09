// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Button, HStack, LabelWithHelp } from "@carbon/react";
import { Trans } from "@lingui/react/macro";
import PlaybackRow from "./AssemblyPlaybackRow";

/**
 * The path a finished sub-assembly travels when it joins the build. Edited in
 * the 3D viewer like a step's motion; Reset returns it to the automatic glide.
 */
export default function SubAssemblyPathRow({
  name,
  hasPath,
  isEditing,
  isDisabled,
  onEdit,
  onStopEdit,
  onReset
}: {
  name: string;
  hasPath: boolean;
  isEditing: boolean;
  isDisabled: boolean;
  onEdit: () => void;
  onStopEdit: () => void;
  onReset: () => void;
}) {
  return (
    <PlaybackRow
      label={
        // A long sub-assembly name ends in an ellipsis instead of running
        // under the buttons.
        <LabelWithHelp
          termId="assembly-sub-assembly-path"
          variant="inline"
          className="max-w-full [&>span:first-child]:min-w-0 [&>span:first-child]:truncate"
        >
          <Trans>{name} path</Trans>
        </LabelWithHelp>
      }
      value={
        isEditing ? (
          <Trans>Drag the red waypoints in the viewer</Trans>
        ) : hasPath ? (
          <Trans>Custom path</Trans>
        ) : (
          <Trans>Automatic</Trans>
        )
      }
    >
      {!isDisabled && (
        <HStack spacing={1} className="shrink-0">
          {hasPath && !isEditing && (
            <Button variant="ghost" size="sm" onClick={onReset}>
              <Trans>Reset</Trans>
            </Button>
          )}
          <Button
            variant={isEditing ? "primary" : "secondary"}
            size="sm"
            onClick={isEditing ? onStopEdit : onEdit}
          >
            {isEditing ? (
              <Trans>Done Editing Path</Trans>
            ) : (
              <Trans>Edit Path</Trans>
            )}
          </Button>
        </HStack>
      )}
    </PlaybackRow>
  );
}
