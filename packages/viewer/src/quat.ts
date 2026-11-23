// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Quaternion, Vector3 } from "three";
import type { Quat, Vec3 } from "./types";

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

export function toVector3(value: Vec3): Vector3 {
  return new Vector3(value[0], value[1], value[2]);
}

/** Normalized, so a slightly-off stored quaternion still turns cleanly. */
export function toQuaternion(value: Quat): Quaternion {
  return new Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

export function toQuat(quaternion: Quaternion): Quat {
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}

/** `q` and `-q` match, as do scaled copies; a zero quaternion matches nothing. */
export function sameOrientation(a: Quat, b: Quat): boolean {
  const norms = Math.hypot(...a) * Math.hypot(...b);
  if (!(norms > 0)) return false;
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  return Math.abs(dot) / norms > 1 - 1e-6;
}
