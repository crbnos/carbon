// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { getPrivateUrl, getRawModelUrl } from "@carbon/files/media";
import { useMode } from "@carbon/react";
import { MODEL_RAW_KEEP_MAX_BYTES } from "@carbon/utils";
import { useCallback, useMemo } from "react";
import { ModelPreview } from "./ModelPreview";
import { type ModelArtifacts, useOptimizedModel } from "./useOptimizedModel";

/**
 * The `ModelPreview` URLs for a model's artifacts — the one place a stored
 * artifact path becomes a URL, shared by every host that mounts a preview.
 */
export function modelPreviewUrls(artifacts: ModelArtifacts | null | undefined) {
  return {
    optimizedUrl: artifacts?.optimizedModelPath
      ? // ?v= busts the immutable preview cache on the STABLE optimized.glb
        // path when a re-optimise lands.
        `${getPrivateUrl(artifacts.optimizedModelPath)}${
          artifacts.optimizedAt
            ? `?v=${encodeURIComponent(artifacts.optimizedAt)}`
            : ""
        }`
      : null,
    glbUrl: artifacts?.glbPath ? getPrivateUrl(artifacts.glbPath) : null,
    // Unique per optimise run, so no cache-buster is needed.
    pmiUrl: artifacts?.pmiPath ? getPrivateUrl(artifacts.pmiPath) : null,
    lodUrl: artifacts?.lodPath ? getPrivateUrl(artifacts.lodPath) : null,
    rawUrl:
      artifacts?.rawPath && (artifacts.size ?? 0) <= MODEL_RAW_KEEP_MAX_BYTES
        ? getRawModelUrl(artifacts.rawBucket, artifacts.rawPath)
        : null,
    thumbnailUrl: artifacts?.thumbnailPath
      ? getPrivateUrl(artifacts.thumbnailPath)
      : null
  };
}

/** A host record made from one PMI item (an inspection characteristic). */
export type PmiLink = { id: string; pmiItemId: string | null };

type ModelUploadPreviewProps = {
  modelUploadId: string;
  modelPath: string | null;
  companyId: string;
  /**
   * Ties the host's records to PMI items: the selected record selects its
   * item on the model (highlighted, camera turned to it), and a pick on the
   * model selects the record made from that item — null for an item no
   * record names, or a cleared pick.
   */
  pmiLinks?: readonly PmiLink[];
  selectedLinkId?: string | null;
  onLinkSelect?: (id: string | null) => void;
  className?: string;
};

/**
 * A read-only preview of a stored model: resolves its artifacts and renders
 * `ModelPreview` with them. Hosts that also upload, delete or recapture the
 * thumbnail (`CadModel`, the MES model tab) mount `ModelPreview` themselves
 * with `modelPreviewUrls`. Import lazily (ClientOnly) — the viewer is three.js.
 */
export function ModelUploadPreview({
  modelUploadId,
  modelPath,
  companyId,
  pmiLinks,
  selectedLinkId,
  onLinkSelect,
  className
}: ModelUploadPreviewProps) {
  const mode = useMode();
  const selectedPmiItemId = useMemo(
    () =>
      pmiLinks
        ? (pmiLinks.find((link) => link.id === selectedLinkId)?.pmiItemId ??
          null)
        : undefined,
    [pmiLinks, selectedLinkId]
  );
  const onPmiItemSelect = useCallback(
    (pmiItemId: string | null) => {
      const link = pmiItemId
        ? pmiLinks?.find((l) => l.pmiItemId === pmiItemId)
        : undefined;
      onLinkSelect?.(link?.id ?? null);
    },
    [pmiLinks, onLinkSelect]
  );
  const {
    artifacts,
    awaitingModel,
    backgroundOptimizing,
    optimizeFailed,
    canRetry,
    retry,
    retryLabel
  } = useOptimizedModel({ modelPath, modelUploadId, companyId });

  return (
    <ModelPreview
      {...modelPreviewUrls(artifacts)}
      awaitingModel={awaitingModel}
      optimizing={backgroundOptimizing}
      optimizeFailed={optimizeFailed}
      sourceMissing={artifacts?.sourceAvailable === false}
      selectedPmiItemId={selectedPmiItemId}
      onPmiItemSelect={pmiLinks ? onPmiItemSelect : undefined}
      mode={mode}
      className={className}
      onRetry={canRetry ? retry : undefined}
      retryLabel={retryLabel}
    />
  );
}

export default ModelUploadPreview;
