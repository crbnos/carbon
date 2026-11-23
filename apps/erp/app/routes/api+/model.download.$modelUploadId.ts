// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { findStorageObjectBuckets } from "@carbon/database/storage-objects";
import { getCompanyPrivateBucket, TEMP_STAGING_BUCKET } from "@carbon/files";
import { isModelRawDownloadable } from "@carbon/files/cad";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { getDatabaseClient } from "~/services/database.server";
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

  // A retained raw lives in the company's own bucket once it is durable, or
  // in `temp-staging` before compaction settles (and when it is too big for
  // the company bucket). The row is companyId-scoped, so the session's own
  // bucket is the right one — never derive it from the path.
  const buckets = await findStorageObjectBuckets(getDatabaseClient(), {
    names: [candidate],
    buckets: [getCompanyPrivateBucket(companyId), TEMP_STAGING_BUCKET]
  });
  const bucket = buckets.get(candidate);
  if (!bucket) {
    throw new Response("Original model file is not available", { status: 404 });
  }

  throw redirect(path.to.file.previewFile(`${bucket}/${candidate}`));
}
