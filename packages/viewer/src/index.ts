// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

export {
  AssemblyPlayer,
  type AssemblyPlayerHandle,
  type AssemblyPlayerProps,
  type AssemblyView,
  type FutureComponentsMode,
  type InstalledComponentsMode
} from "./AssemblyPlayer";
export { AssemblyViewer, type AssemblyViewerProps } from "./AssemblyViewer";
export { type FramingFit, fitFraming } from "./camera";
export { describeStep, type NamedUnit } from "./describe";
export { synthesizeFallbackMotion } from "./fallback";
export {
  type AssemblyGraphIndex,
  type ComponentGroup,
  groupComponentNodeIds,
  indexAssemblyGraph
} from "./graph";
export {
  ModelCanvas,
  type ModelCanvasProps,
  type ModelMetrics
} from "./ModelCanvas";
export {
  buildStepClip,
  displayMotionForStep,
  type MotionKeyframeOptions,
  type MotionKeyframes,
  motionDuration,
  motionToKeyframes,
  motionTravelDistance,
  naturalizeMotion,
  type Pose,
  type StepClipOptions,
  stepTimelineSeconds
} from "./motion";
export {
  type AssemblyPlan,
  type AssemblyPlanComponent,
  type AssemblyStepGroup,
  assignStepPhases,
  buildAssemblyStepGroups,
  CURRENT_PLAN_VERSION,
  type PlannedMotion,
  planMotionForComponents,
  type StepPhase
} from "./plan";
export {
  buildStaging,
  EMPTY_STAGING,
  type JoinTargets,
  joinTargets,
  parkedOffsetsAt,
  STAGING_GLIDE_SECONDS,
  type Staging,
  type StagingJoin,
  stagedGroupNodeIds
} from "./staging";
export type {
  AssemblyGraph,
  AssemblyGraphNode,
  AssemblyStep,
  CameraPose,
  Fastener,
  HelixMotion,
  LinearMotion,
  LMotion,
  Motion,
  NoneMotion,
  PathMotion,
  PlanViewHint,
  Quat,
  Vec3
} from "./types";
export { type UseAssemblyResult, useAssembly } from "./useAssembly";
export {
  ASSEMBLY_VIEWS,
  type ComponentVisual,
  VIEW_MODES,
  viewForModes,
  visualForComponent
} from "./visibility";
