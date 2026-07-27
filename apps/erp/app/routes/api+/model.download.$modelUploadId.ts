import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { isModelRawDownloadable } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Resolves the DOWNLOADABLE bytes for a model — always the customer's original
// upload, never a derived artifact. Compaction repoints `modelPath` at an OCCT
// `.xbf.zst` no CAD tool can open; the original survives at `originalPath`
// (mesh raws instead keep a `.zst` modelPath that decompresses byte-identical).
// Redirects into the auth-checked /file/preview proxy, which decompresses `.zst`
// server-side and sets the content type from the inner extension.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});
  const { modelUploadId } = params;
  if (!modelUploadId) throw new Response("Not found", { status: 404 });

  const model = await client
    .from("modelUpload")
    .select("modelPath, originalPath")
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();

  if (model.error) throw new Response("Internal error", { status: 500 });
  if (!model.data) throw new Response("Not found", { status: 404 });

  // Original when tracked; else the raw modelPath as long as it still yields
  // original bytes (pre-compact raws, mesh `.zst`). `.xbf` never qualifies —
  // legacy rows compacted before originals were retained have no downloadable
  // copy (404, surfaced as a toast client-side; never a corrupt file).
  const candidate =
    model.data.originalPath ??
    (model.data.modelPath && isModelRawDownloadable(model.data.modelPath)
      ? model.data.modelPath
      : null);
  if (!candidate) {
    throw new Response("Original model file is not available", { status: 404 });
  }

  // Retained raws live in `private` once persisted, or `temp-staging` before
  // compaction settles / when oversized — probe both (same resolution as the
  // model.artifacts route).
  const serviceRole = getCarbonServiceRole();
  const probe = (bucket: "private" | "temp-staging") =>
    serviceRole.storage
      .from(bucket)
      .info(candidate)
      .catch(() => ({ data: null, error: true as const }));
  const durable = await probe("private");
  let bucket: string | null = !durable.error && durable.data ? "private" : null;
  if (!bucket) {
    const staged = await probe("temp-staging");
    if (!staged.error && staged.data) bucket = "temp-staging";
  }
  if (!bucket) {
    throw new Response("Original model file is not available", { status: 404 });
  }

  throw redirect(path.to.file.previewFile(`${bucket}/${candidate}`));
}
