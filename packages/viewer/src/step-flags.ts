// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Plain checks on a step's stored `camera` and `warnings`, shared by the
 * player, the ERP editor and server code. Three-free and zod-free, so it is
 * safe on the `./steps` entry point.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A view the author saved (`{ position, target, fov }`), applied as-is — not a
 * planner hint (`{ source: "plan", direction }`), which only aims live framing.
 */
export function isSavedView(
  camera: unknown
): camera is { position: unknown[]; target: unknown[] } {
  if (typeof camera !== "object" || camera === null) return false;
  if ("source" in camera) return false;
  const pose = camera as Record<string, unknown>;
  return Array.isArray(pose.position) && Array.isArray(pose.target);
}

/**
 * The step's motion was drawn by hand in the path editor
 * (`warnings.plannedMotion` is present). The planner stores `none` on a
 * flagged step, so a flagged step that moves was drawn too — paths drawn
 * before `plannedMotion` existed carry no marker.
 */
export function hasCustomMotion(warnings: unknown, motion: unknown): boolean {
  const flags = asRecord(warnings);
  if (flags.plannedMotion !== undefined) return true;
  return (
    flags.flagged === true &&
    typeof motion === "object" &&
    motion !== null &&
    "type" in motion &&
    motion.type !== "none"
  );
}

/**
 * The planner found no clear path for the step's parts (`flagged`) and the
 * author has not drawn one by hand, which overrides the flag.
 */
export function isPlanFlagged(warnings: unknown, motion: unknown): boolean {
  return (
    asRecord(warnings).flagged === true && !hasCustomMotion(warnings, motion)
  );
}
