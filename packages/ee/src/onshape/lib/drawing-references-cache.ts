// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { redis } from "@carbon/kv";
import type { DrawingReference } from "../panel/drawings";

// What a drawing references, per drawing state, so a later review reads only
// new or changed drawings. A drawing at one microversion (or in one version)
// never changes what it shows, so an entry is never stale; the TTL only bounds
// storage. Every Redis failure reads as a miss and never fails a review.

export const DRAWING_REFERENCES_TTL_SECONDS = 30 * 24 * 60 * 60;

export type CachedDrawingReferences = {
  references: DrawingReference[];
};

export type DrawingCacheKey = {
  companyId: string;
  documentId: string;
  elementId: string;
  /**
   * The drawing's microversion, or `v:<versionId>` in a version. Null: the
   * state is unknown and nothing is cached.
   */
  state: string | null;
};

export function drawingReferencesKey(key: DrawingCacheKey): string | null {
  if (!key.state) return null;
  return [
    // v2: references carry the part from `idTag`.
    "onshape-drawing-refs:v2",
    key.companyId,
    key.documentId,
    key.elementId,
    key.state
  ].join(":");
}

/** The state a drawing is cached under: its version, else its microversion. */
export function drawingState(drawing: {
  wvm: "w" | "v";
  wvmId: string;
  microversionId: string | null;
}): string | null {
  return drawing.wvm === "v" ? `v:${drawing.wvmId}` : drawing.microversionId;
}

export async function getCachedReferences(
  key: DrawingCacheKey
): Promise<CachedDrawingReferences | null> {
  const redisKey = drawingReferencesKey(key);
  if (!redisKey) return null;
  try {
    const raw = await redis.get(redisKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDrawingReferences;
    return Array.isArray(parsed?.references) ? parsed : null;
  } catch {
    return null;
  }
}

export async function cacheReferences(
  key: DrawingCacheKey,
  value: CachedDrawingReferences
): Promise<void> {
  const redisKey = drawingReferencesKey(key);
  if (!redisKey) return;
  try {
    await redis.set(
      redisKey,
      JSON.stringify(value),
      "EX",
      DRAWING_REFERENCES_TTL_SECONDS
    );
  } catch {
    // A lost write costs one read on the next review.
  }
}
