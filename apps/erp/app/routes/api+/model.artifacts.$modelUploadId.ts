import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import type { LoaderFunctionArgs } from "react-router";

// Resolves a model's optimised / preview artifact storage paths for the
// progressive ModelPreview. CadModel fetches this by modelUploadId (derived from
// modelPath — modelUpload.id is the model filename), so the tiers don't have to
// be threaded through every item/line summary loader. Returns only paths (the
// bytes are still served through the auth-checked /file/preview proxy), scoped to
// the company. Any employee who can reach the page can resolve them.
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    role: "employee"
  });
  const { modelUploadId } = params;
  if (!modelUploadId) throw new Response("Not found", { status: 404 });

  const model = await client
    .from("modelUpload")
    .select(
      "size, originalSize, optimizedSize, optimizedModelPath, glbPath, thumbnailPath, optimizeStatus, modelPath"
    )
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();

  // A real query failure is a 5xx, not a 404 — don't mask a backend error as
  // "no such model".
  if (model.error) throw new Response("Internal error", { status: 500 });
  // No such model for this tenant → 404, don't fabricate an all-nulls body. An
  // all-nulls 200 is indistinguishable from "exists but not optimised", so the
  // viewer's reuse guard can't tell the two apart and would auto-fire an
  // optimise against an id that doesn't exist (→ a reoptimise 404 loop). The
  // client query treats this 404 as "no artifacts", and never auto-fires.
  if (!model.data) throw new Response("Not found", { status: 404 });

  // Raw-source pointer for the viewer's WASM fallback tier (renders the original
  // upload when no artifact exists). `.zst`-compacted raws are skipped — they
  // only exist after a successful optimise, which means an artifact exists too.
  // Bucket split: current uploads land in `temp-staging`; pre-assembler rows
  // lived in `private` — probe temp-staging and fall back.
  let rawPath: string | null = null;
  let rawBucket = "temp-staging";
  const modelPath = model.data?.modelPath ?? null;
  if (modelPath && !modelPath.toLowerCase().endsWith(".zst")) {
    rawPath = modelPath;
    const staged = await getCarbonServiceRole()
      .storage.from("temp-staging")
      .info(modelPath)
      .catch(() => ({ data: null, error: true as const }));
    if (staged.error || !staged.data) rawBucket = "private";
  }

  return {
    optimizedModelPath: model.data?.optimizedModelPath ?? null,
    // lodPath tier is pending (assembler single-draw LOD) — added in a later migration.
    lodPath: null as string | null,
    glbPath: model.data?.glbPath ?? null,
    thumbnailPath: model.data?.thumbnailPath ?? null,
    rawPath,
    rawBucket,
    // Lets the client stop polling once optimisation lands (or fails).
    optimizeStatus: model.data?.optimizeStatus ?? null,
    // The reduction badge compares as-uploaded vs optimised bytes. `size` is
    // the STORED raw (rewritten to the .zst size after compaction), so prefer
    // the frozen originalSize; older rows fall back to size.
    size: model.data?.originalSize ?? model.data?.size ?? null,
    optimizedSize: model.data?.optimizedSize ?? null
  };
}
