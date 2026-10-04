// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { AssemblyPlayback } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { ActivityIndicator, Text, View } from "react-native";
import { Muted } from "~/components/ui";
import { ModelViewer } from "./ModelViewer";
import { playbackIndexFor } from "./modelVisibility";
import { useAssemblyModel } from "./useAssemblyModel";

/**
 * The 3D tab: downloads the instruction's model once, then renders it at the
 * step the operator is on.
 *
 * The download is deliberately not started until this tab is opened — a model
 * is two to forty megabytes, and an operator who never opens the 3D view on a
 * metered connection should never pay for it. Once fetched it is on disk, so
 * coming back is instant.
 */
export function ModelPane({
  operationId,
  playback,
  /** The `assemblyInstructionStepId` of the procedure step on screen. */
  instructionStepId,
  /** That step's position, used only when it carries no instruction id. */
  stepIndex,
  active
}: {
  operationId: string;
  playback: AssemblyPlayback;
  instructionStepId: string | null | undefined;
  stepIndex: number;
  active: boolean;
}) {
  const { t } = useLingui();
  const model = useAssemblyModel({
    operationId,
    glbPath: playback.glbPath,
    graphPath: playback.graphPath,
    enabled: active
  });

  if (model.isError) {
    return (
      <Centered>
        <Text className="text-center text-sm text-foreground">
          {t`The 3D model could not be loaded.`}
        </Text>
        <Muted className="pt-1 text-center text-sm">
          {t`Pull down on the Build tab to try again.`}
        </Muted>
      </Centered>
    );
  }

  if (!model.data) {
    return (
      <Centered>
        <ActivityIndicator />
        <Muted className="pt-2 text-sm">{t`Downloading the 3D model`}</Muted>
      </Centered>
    );
  }

  return (
    <ModelViewer
      glbUri={model.data.glbUri}
      graphRoot={model.data.graphRoot}
      steps={playback.steps}
      activeStepIndex={playbackIndexFor(
        playback.steps,
        instructionStepId,
        stepIndex
      )}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View className="flex-1 items-center justify-center px-8">{children}</View>
  );
}
