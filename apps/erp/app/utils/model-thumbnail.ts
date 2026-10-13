// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Model towards camera, in the model's own axes (Z up). */
export type ViewDirection = [number, number, number];

/**
 * Ask for a model's thumbnail to be drawn again and wait for it. The render
 * runs in the background, and each one is written to a new path, so the new
 * path appearing on the model is the signal that it landed.
 *
 * Resolves to the new path, or `null` when it has not landed within the wait
 * (it may still arrive). Throws when the request is refused or the model
 * cannot be read. `isActive`
 * lets a caller that has unmounted stop the wait.
 */
export async function regenerateModelThumbnail({
  carbon,
  modelId,
  direction,
  isActive = () => true
}: {
  carbon: SupabaseClient<Database>;
  modelId: string;
  /** Omit for the viewer's home view. */
  direction?: ViewDirection;
  isActive?: () => boolean;
}): Promise<string | null> {
  const currentPath = async () => {
    const { data, error } = await carbon
      .from("modelUpload")
      .select("thumbnailPath")
      .eq("id", modelId)
      .maybeSingle();
    // A failed read is not "no thumbnail": treated as one, the old path would
    // later look like a new one.
    if (error) throw error;
    return data?.thumbnailPath ?? null;
  };
  const before = await currentPath();

  const body = new FormData();
  body.append("modelUploadId", modelId);
  if (direction) body.append("direction", JSON.stringify(direction));
  const response = await fetch("/api/model/thumbnail", {
    method: "POST",
    body
  });
  if (!response.ok) throw new Error(`thumbnail ${response.status}`);

  const deadline = Date.now() + 90_000;
  while (isActive() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!isActive()) return null;
    const path = await currentPath();
    if (path && path !== before) return path;
  }
  return null;
}
