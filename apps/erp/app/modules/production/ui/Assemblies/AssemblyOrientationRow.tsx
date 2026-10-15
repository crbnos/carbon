// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  Button,
  HStack,
  IconButton,
  LabelWithHelp,
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from "@carbon/react";
import type { AssemblyStep, BuildTurn, SubAssemblyInfo } from "@carbon/viewer";
import {
  describeOrientation,
  IDENTITY_ORIENTATION,
  resolveOrientations
} from "@carbon/viewer";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import {
  LuArrowBigDown,
  LuArrowBigUp,
  LuFlipVertical2,
  LuRotateCcw,
  LuRotateCw
} from "react-icons/lu";
import PlaybackRow from "./AssemblyPlaybackRow";
import type { BuildOrientationControls } from "./useBuildOrientation";

export default function AssemblyOrientationRow({
  stepId,
  viewerSteps,
  subPlan,
  isDisabled,
  controls
}: {
  stepId: string;
  viewerSteps: AssemblyStep[];
  subPlan: Map<string, SubAssemblyInfo>;
  isDisabled: boolean;
  controls: BuildOrientationControls;
}) {
  const { t } = useLingui();

  const orientation = useMemo(() => {
    const index = viewerSteps.findIndex((s) => s.id === stepId);
    return index < 0 ? null : (resolveOrientations(viewerSteps)[index] ?? null);
  }, [viewerSteps, stepId]);
  const ownsOrientation = orientation?.sourceStepId === stepId;
  const orientationSource =
    orientation?.sourceStepId && !ownsOrientation
      ? subPlan.get(orientation.sourceStepId)?.number
      : undefined;
  const pose = describeOrientation(
    orientation?.orientation ?? IDENTITY_ORIENTATION
  );
  const turnButtons: { turn: BuildTurn; label: string; icon: JSX.Element }[] = [
    { turn: "flip", label: t`Flip over`, icon: <LuFlipVertical2 /> },
    { turn: "tipForward", label: t`Tip toward you`, icon: <LuArrowBigDown /> },
    { turn: "tipBack", label: t`Tip away from you`, icon: <LuArrowBigUp /> },
    { turn: "spinLeft", label: t`Spin left`, icon: <LuRotateCcw /> },
    { turn: "spinRight", label: t`Spin right`, icon: <LuRotateCw /> }
  ];

  return (
    <div>
      <PlaybackRow
        label={
          <LabelWithHelp termId="assembly-build-orientation" variant="inline">
            <Trans>Orientation</Trans>
          </LabelWithHelp>
        }
        value={
          orientationSource && pose !== "upright" ? (
            pose === "upsideDown" ? (
              <Trans>Upside down, from step {orientationSource}</Trans>
            ) : (
              <Trans>On its side, from step {orientationSource}</Trans>
            )
          ) : pose === "upsideDown" ? (
            <Trans>Upside down</Trans>
          ) : pose === "onSide" ? (
            <Trans>On its side</Trans>
          ) : (
            <Trans>Upright</Trans>
          )
        }
      >
        {!isDisabled && ownsOrientation && (
          <Button
            variant="ghost"
            size="sm"
            isDisabled={controls.isSaving}
            onClick={() => controls.onReset(stepId)}
          >
            <Trans>Reset</Trans>
          </Button>
        )}
      </PlaybackRow>
      {!isDisabled && (
        <HStack spacing={1} className="px-2 pb-2">
          {turnButtons.map(({ turn, label, icon }) => (
            <Tooltip key={turn}>
              <TooltipTrigger asChild>
                <IconButton
                  aria-label={label}
                  icon={icon}
                  variant="ghost"
                  size="sm"
                  isDisabled={controls.isSaving}
                  onClick={() => controls.onTurn(stepId, turn)}
                />
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </HStack>
      )}
    </div>
  );
}
