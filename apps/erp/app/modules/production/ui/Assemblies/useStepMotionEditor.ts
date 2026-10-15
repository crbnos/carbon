// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { toast } from "@carbon/react";
import type {
  AssemblyPlayerHandle,
  AssemblyStep,
  CameraPose,
  Motion
} from "@carbon/viewer";
import { subAssemblyPartIds } from "@carbon/viewer";
import { useLingui } from "@lingui/react/macro";
import type { RefObject } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSubmit } from "react-router";
import { path } from "~/utils/path";
import { stepPatchFormData } from "./assembly-step-patch";

export type MotionEditing = {
  /** The selected step's own motion path is open in the 3D editor */
  isEditingStep: boolean;
  /** The sub-assembly whose joining path is open in the 3D editor, if any */
  editingUnitId: string | null;
  /** Opens the editor on a step's motion, or on a sub-assembly it carries in */
  onEdit: (stepId: string, unitHeaderId?: string) => void;
  onStop: () => void;
  /** Puts back the motion a step or sub-assembly had before its path was drawn */
  onReset: (stepId: string) => void;
};

/** The Camera row's actions: pin the current view, or return to automatic. */
export type CameraControls = {
  onSet: (stepId: string) => void;
  onClear: (stepId: string) => void;
};

/**
 * The 3D viewer edits the selected step's motion path (drag waypoints) and
 * captures its camera; both autosave through the step-motion route so they
 * never round-trip the whole step form. `editMotion` is the controlled value
 * the player renders while editing.
 */
export function useStepMotionEditor({
  id,
  viewerSteps,
  playerRef,
  selectedStepId,
  setSelectedStepId
}: {
  id: string;
  viewerSteps: AssemblyStep[];
  playerRef: RefObject<AssemblyPlayerHandle>;
  selectedStepId: string | null;
  setSelectedStepId: (stepId: string) => void;
}) {
  const { t } = useLingui();
  const submit = useSubmit();
  const [editingStepId, setEditingStepId] = useState<string | null>(null);
  // A sub-assembly header whose joining path is edited instead of the step's own.
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [draftMotion, setDraftMotion] = useState<Motion | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMotion = useRef<{ targetId: string; motion: Motion } | null>(
    null
  );

  const saveMotion = useCallback(
    (
      stepId: string,
      body: { motion?: Motion; camera?: CameraPose | null; reset?: boolean }
    ) => {
      // One fetcher per row and column: a new submit on a fetcher aborts the
      // one in flight, so a shared fetcher let a Reset or Set view cancel a
      // drag save on another row. A newer save of the same column still
      // replaces an older one (Reset writes `motion` too).
      const column = body.camera !== undefined ? "camera" : "motion";
      submit(stepPatchFormData(body), {
        method: "post",
        action: path.to.assemblyInstructionStepMotion(id, stepId),
        navigate: false,
        fetcherKey: `assembly-step-${column}-${stepId}`
      });
    },
    [submit, id]
  );

  // The drag autosave waits 400 ms; leaving or switching an edit sends it now.
  const flushMotionSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = pendingMotion.current;
    pendingMotion.current = null;
    if (pending) saveMotion(pending.targetId, { motion: pending.motion });
  }, [saveMotion]);

  // Selecting another step leaves the edit session; a drag still waiting to
  // save is sent by its timer.
  const leaveEdit = useCallback(() => {
    setEditingStepId(null);
    setEditingUnitId(null);
    setDraftMotion(null);
  }, []);

  const onEdit = useCallback(
    (stepId: string, unitHeaderId?: string) => {
      flushMotionSave();
      const edited = viewerSteps.find((s) => s.id === (unitHeaderId ?? stepId));
      setSelectedStepId(stepId);
      setEditingStepId(stepId);
      setEditingUnitId(unitHeaderId ?? null);
      setDraftMotion(edited?.motion ?? { type: "none" });
    },
    [viewerSteps, flushMotionSave, setSelectedStepId]
  );

  const onStop = useCallback(() => {
    flushMotionSave();
    leaveEdit();
  }, [flushMotionSave, leaveEdit]);

  const onMotionChange = useCallback(
    (stepId: string, motion: Motion) => {
      setDraftMotion(motion);
      // A sub-assembly's path lives on its header row.
      pendingMotion.current = { targetId: editingUnitId ?? stepId, motion };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushMotionSave, 400);
    },
    [flushMotionSave, editingUnitId]
  );

  const onReset = useCallback(
    (stepId: string) => {
      // A drag still waiting to save on this row must not land after the reset.
      if (pendingMotion.current?.targetId === stepId) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        pendingMotion.current = null;
      } else {
        flushMotionSave();
      }
      saveMotion(stepId, { reset: true });
    },
    [saveMotion, flushMotionSave]
  );

  const onSetCamera = useCallback(
    (stepId: string) => {
      const pose = playerRef.current?.captureCameraPose();
      if (!pose) {
        toast.error(t`The model isn't ready yet`);
        return;
      }
      saveMotion(stepId, { camera: pose });
    },
    [playerRef, saveMotion, t]
  );

  const onClearCamera = useCallback(
    (stepId: string) => saveMotion(stepId, { camera: null }),
    [saveMotion]
  );

  const isEditingSelected =
    editingStepId !== null && selectedStepId === editingStepId;
  const editingUnitPartIds = useMemo(
    () =>
      editingUnitId ? subAssemblyPartIds(viewerSteps, editingUnitId) : null,
    [editingUnitId, viewerSteps]
  );

  const editMotion =
    editingStepId && isEditingSelected && draftMotion
      ? {
          stepId: editingStepId,
          motion: draftMotion,
          ...(editingUnitPartIds ? { nodeIds: editingUnitPartIds } : {})
        }
      : null;

  // Memoized: the panel is memoized and must not re-render on every drag frame.
  const isEditingStep = isEditingSelected && editingUnitId === null;
  const selectedUnitId = isEditingSelected ? editingUnitId : null;
  const motionEditing = useMemo<MotionEditing>(
    () => ({
      isEditingStep,
      editingUnitId: selectedUnitId,
      onEdit,
      onStop,
      onReset
    }),
    [isEditingStep, selectedUnitId, onEdit, onStop, onReset]
  );
  const camera = useMemo<CameraControls>(
    () => ({ onSet: onSetCamera, onClear: onClearCamera }),
    [onSetCamera, onClearCamera]
  );

  return { editMotion, onMotionChange, leaveEdit, motionEditing, camera };
}
