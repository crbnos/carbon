// SPDX-License-Identifier: AGPL-3.0-only
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
export { buildStepClip, type StepClipOptions } from "./clip";
export { describeStep, type NamedUnit } from "./describe";
export { displayMotionForStep, naturalizeMotion } from "./display";
export { synthesizeFallbackMotion } from "./fallback";
export {
  type AssemblyGraphIndex,
  type ComponentGroup,
  groupComponentNodeIds,
  indexAssemblyGraph
} from "./graph";
export {
  type MotionKeyframeOptions,
  type MotionKeyframes,
  motionToKeyframes,
  type Pose
} from "./keyframes";
export {
  ModelCanvas,
  type ModelCanvasProps,
  type ModelMetrics,
  type PmiFocusRequest
} from "./ModelCanvas";
export {
  type BuildTurn,
  describeOrientation,
  isOrientation,
  type OrientationPose,
  type ResolvedOrientation,
  resolveOrientations,
  turnOrientation,
  upForOrientation
} from "./orientation";
export { PmiLayer, type PmiLayerProps } from "./PmiLayer";
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
  formatPmiItem,
  groupPmiItems,
  PMI_VERSION,
  type PmiBounds,
  type PmiDatum,
  type PmiDimension,
  type PmiDimensionType,
  type PmiDisplayUnit,
  type PmiDocument,
  type PmiGroup,
  type PmiGroupTitle,
  type PmiItem,
  type PmiItemLabel,
  type PmiKind,
  type PmiMesh,
  type PmiPlane,
  type PmiTolerance,
  type PmiToleranceType,
  type PmiView,
  parsePmiDocument,
  pmiItemBounds,
  pmiViewBounds,
  visibleItemIds
} from "./pmi";
export { IDENTITY_QUAT as IDENTITY_ORIENTATION, sameOrientation } from "./quat";
export { hasCustomMotion, isPlanFlagged, isSavedView } from "./step-flags";
export {
  arrivalIndexByNode,
  buildSubAssemblyPlan,
  displayOrder,
  isSubAssemblyHeader,
  type SubAssemblyInfo,
  type SubAssemblyRule,
  type SubAssemblyViolation,
  subAssemblyPartIds,
  type UnusableReason,
  usableSubAssemblies,
  validateSubAssemblies
} from "./subassembly";
export {
  motionDuration,
  motionTravelDistance,
  stepClipTiming
} from "./timing";
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
export { isPlayableMotion } from "./validate-motion";
export {
  ASSEMBLY_VIEWS,
  type ComponentVisual,
  VIEW_MODES,
  viewForModes,
  visualForComponent
} from "./visibility";
