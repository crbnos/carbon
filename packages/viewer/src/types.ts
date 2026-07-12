/**
 * Shared contracts for animated work instructions (Phase 0).
 * These types mirror `docs/specs/animated-work-instructions-contracts.md` exactly.
 * Change them only by updating the geometry service, the ERP/Inngest layer, and
 * this package together.
 */

export type Vec3 = [number, number, number];

/** Quaternion as [x, y, z, w] */
export type Quat = [number, number, number, number];

/** Linear insertion along a vector. Distances in mm, GLB world space. */
export type LinearMotion = {
  type: "linear";
  direction: Vec3;
  distance: number;
};

/** Two-segment motion: travel1 then travel2 (insertion order), e.g. slide then drop. */
export type LMotion = {
  type: "L";
  segments: { direction: Vec3; distance: number }[];
};

/**
 * Threaded fastener: linear approach along `axis`, then `turns` rotations about
 * `axis` (through `origin`) advancing `pitch` mm per turn until seated.
 */
export type HelixMotion = {
  type: "helix";
  axis: Vec3;
  origin: Vec3;
  pitch: number;
  turns: number;
  /** Linear travel (mm) along `axis` before threading begins */
  approach: number;
};

/**
 * Explicit keyframe path (planner tier 5 / manual freeform).
 * Keyframes are absolute world poses for the component; `t` is normalized 0..1 and
 * must be strictly increasing. The last keyframe must equal the component's final
 * (seated) pose.
 */
export type PathMotion = {
  type: "path";
  keyframes: { t: number; position: Vec3; quaternion: Quat }[];
};

/** No geometry motion (process-only step: cure, inspect, torque pattern). */
export type NoneMotion = {
  type: "none";
};

/**
 * Describes the insertion motion of a step's components into the assembly. The
 * viewer derives removal (the reverse) and start poses from it.
 */
export type Motion =
  | LinearMotion
  | LMotion
  | HelixMotion
  | PathMotion
  | NoneMotion;

/** Step camera. `null` on a step means the viewer auto-frames the active components. */
export type CameraPose = {
  position: Vec3;
  target: Vec3;
  fov: number;
};

/**
 * Planner-baked camera hint: a mesh-precise view DIRECTION (target→eye, unit)
 * chosen with sight lines against the real triangles of everything installed
 * earlier. The viewer supplies the rest live — target, standing distance, and
 * frustum fit at the actual viewport aspect. Distinct from a manual
 * {@link CameraPose}, which is applied verbatim.
 */
export type PlanViewHint = {
  source: "plan";
  direction: Vec3;
};

/** Fastener callout for a step. All fields optional. */
export type Fastener = {
  spec?: string;
  count?: number;
  torqueNm?: number;
  tool?: string;
};

export type AssemblyStep = {
  id: string;
  title: string | null;
  instructionText: string | null;
  /** Components installed in this step (stable nodeIds from glTF extras/graph.json) */
  componentNodeIds: string[];
  motion: Motion;
  camera: CameraPose | PlanViewHint | null;
  fastener: Fastener | null;
  /** Optional authored override for the step's timeline length (seconds) */
  durationSeconds?: number | null;
  /**
   * The planner proved no collision-free path for these components. The player
   * fades them in at the seated pose instead of synthesizing a fallback
   * motion — a fabricated path would animate straight through geometry.
   */
  flagged?: boolean;
  /**
   * Subassembly phase this step belongs to (baked at step generation from the
   * plan's contact graph). `null`/absent = the main phase, built seated. A
   * non-null phase builds staged off to the side and flies into the main body
   * at its `join` step. See `@carbon/viewer` staging.
   */
  phase?: { id: string; name: string; join: boolean } | null;
};

/** One node of the assembly tree in graph.json. */
export type AssemblyGraphNode = {
  /** sha1(geometryHash : parentPath : siblingOrdinal)[:16] */
  nodeId: string;
  name: string;
  isAssembly: boolean;
  /** null for assemblies */
  geometryHash: string | null;
  /** Local transform, column-major 4x4 */
  transform: number[];
  /** World-space bounds, mm */
  bbox: { min: Vec3; max: Vec3 };
  /** mm^3, leaf nodes only (null for assemblies) */
  volume: number | null;
  /** RGBA 0-1 or null */
  color: [number, number, number, number] | null;
  children: AssemblyGraphNode[];
};

/** graph.json as written by the geometry service /convert endpoint. */
export type AssemblyGraph = {
  version: 1;
  /** Normalized output unit (always mm in Phase 0) */
  unit: "mm";
  /** Unit declared in the STEP file */
  sourceUnit: string;
  /** Count of leaf instances */
  componentCount: number;
  /** Assembly tree; root has no geometry */
  root: AssemblyGraphNode;
};
