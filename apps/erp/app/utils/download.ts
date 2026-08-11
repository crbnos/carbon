import { path } from "~/utils/path";

export type ModelDownloadResult = "ok" | "unavailable" | "error";

/**
 * Download a model's ORIGINAL file bytes via the api/model/download route
 * (which resolves `originalPath` and redirects through the auth-checked
 * /file/preview proxy — `.zst` raws are decompressed server-side).
 *
 * Returns a result instead of toasting so callers keep their own (localized)
 * error copy. "unavailable" = no original exists for this model (legacy rows
 * compacted before originals were retained); "error" = network/server failure.
 * Never saves a non-OK response body to disk — that is how corrupt "STEP"
 * downloads were born.
 */
export async function downloadModelFile(model: {
  modelId: string | null;
  modelName: string | null;
}): Promise<ModelDownloadResult> {
  if (!model.modelId || !model.modelName) return "error";
  try {
    const response = await fetch(path.to.api.modelDownload(model.modelId));
    if (!response.ok) {
      return response.status === 404 ? "unavailable" : "error";
    }
    const blob = await response.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    document.body.appendChild(a);
    a.href = blobUrl;
    a.download = model.modelName;
    a.click();
    window.URL.revokeObjectURL(blobUrl);
    document.body.removeChild(a);
    return "ok";
  } catch {
    return "error";
  }
}
