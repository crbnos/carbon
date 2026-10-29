// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import type {
  AssemblyPlayerHandle,
  AssemblyStep,
  BuildTurn,
  CameraPose,
  Quat
} from "@carbon/viewer";
import {
  isOrientation,
  isSavedView,
  resolveOrientations,
  sameOrientation,
  turnOrientation
} from "@carbon/viewer";
import { useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useCallback, useMemo } from "react";
import { useFetcher } from "react-router";
import { path } from "~/utils/path";
import { stepPatchFormData } from "./assembly-step-patch";

export type BuildOrientationControls = {
  /** Turns the build on a step, as seen from the current view */
  onTurn: (stepId: string, turn: BuildTurn) => void;
  /** The step keeps the previous step's build orientation again */
  onReset: (stepId: string) => void;
  isSaving: boolean;
};

/**
 * Saves a step's build orientation on its own fetcher. While a save is in
 * flight, the returned `viewerSteps` carry the orientation being saved, so the
 * viewer and the panel show it before the loader catches up.
 */
export function useBuildOrientation({
  id,
  steps,
  playerRef
}: {
  id: string;
  steps: AssemblyStep[];
  playerRef: RefObject<AssemblyPlayerHandle>;
}) {
  const { t } = useLingui();
  const fetcher = useFetcher<{ success: boolean }>();

  const pending = useMemo(() => {
    const formData = fetcher.formData;
    const stepId = formData?.get("stepId");
    const raw = formData?.get("orientation");
    if (typeof stepId !== "string" || typeof raw !== "string") return null;
    const parsed: unknown = JSON.parse(raw);
    return { stepId, orientation: isOrientation(parsed) ? parsed : null };
  }, [fetcher.formData]);

  const viewerSteps = useMemo(
    () =>
      pending
        ? steps.map((step) =>
            step.id === pending.stepId
              ? { ...step, orientation: pending.orientation }
              : step
          )
        : steps,
    [steps, pending]
  );

  const save = useCallback(
    (stepId: string, orientation: Quat | null, camera?: CameraPose) => {
      const formData = stepPatchFormData({ orientation, camera });
      // Read back by `pending` above; the route ignores it.
      formData.set("stepId", stepId);
      fetcher.submit(formData, {
        method: "post",
        action: path.to.assemblyInstructionStepMotion(id, stepId)
      });
    },
    [fetcher, id]
  );

  // A turn back onto the inherited orientation saves `null`. A turned step with
  // no saved view (a plan hint doesn't count) also pins the current view, since
  // the camera holds still while the build turns; a saved view is never replaced.
  const onTurn = useCallback(
    (stepId: string, turn: BuildTurn) => {
      const pose = playerRef.current?.captureCameraPose();
      if (!pose) {
        toast.error(t`The model isn't ready yet`);
        return;
      }
      const index = viewerSteps.findIndex((step) => step.id === stepId);
      if (index < 0) return;
      const current = resolveOrientations(viewerSteps)[index];
      if (!current) return;
      const next = turnOrientation(current.orientation, turn, pose);
      const inherited = resolveOrientations(
        viewerSteps.map((step) =>
          step.id === stepId ? { ...step, orientation: null } : step
        )
      )[index];
      const orientation =
        inherited && sameOrientation(next, inherited.orientation) ? null : next;
      const hasSavedView = isSavedView(viewerSteps[index]?.camera);
      save(
        stepId,
        orientation,
        orientation && !hasSavedView ? pose : undefined
      );
    },
    [playerRef, viewerSteps, save, t]
  );

  const onReset = useCallback((stepId: string) => save(stepId, null), [save]);

  const isSaving = fetcher.state !== "idle";
  const orientation = useMemo<BuildOrientationControls>(
    () => ({ onTurn, onReset, isSaving }),
    [onTurn, onReset, isSaving]
  );

  return { viewerSteps, orientation };
}
