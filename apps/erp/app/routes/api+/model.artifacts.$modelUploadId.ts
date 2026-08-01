import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ASSEMBLER_SERVICE_URL } from "@carbon/env";
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
      "size, originalSize, optimizedSize, optimizedModelPath, glbPath, thumbnailPath, optimizeStatus, optimizedAt, modelPath, originalPath"
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
  // upload when no artifact exists). Prefer the retained ORIGINAL (xbf-compacted
  // rows keep the uploaded STEP at `originalPath` — the `.xbf.zst` itself isn't
  // WASM-renderable); else the uncompacted `modelPath`. A retained raw is
  // relocated to the DURABLE `private` bucket; a just-uploaded one is briefly in
  // ephemeral `temp-staging` before relocation; a pruned one is in neither → no
  // raw tier (rely on the GLB).
  let rawPath: string | null = null;
  let rawBucket = "private";
  const modelPath = model.data?.modelPath ?? null;
  const rawCandidate =
    model.data?.originalPath ??
    (modelPath && !modelPath.toLowerCase().endsWith(".zst") ? modelPath : null);
  const svc = getCarbonServiceRole();
  const exists = async (path: string) => {
    for (const bucket of ["private", "temp-staging"] as const) {
      const info = await svc.storage
        .from(bucket)
        .info(path)
        .catch(() => ({ data: null, error: true as const }));
      if (!info.error && info.data) return bucket;
    }
    return null;
  };
  if (rawCandidate) {
    const bucket = await exists(rawCandidate);
    if (bucket) {
      rawPath = rawCandidate;
      rawBucket = bucket;
    }
    // Absent in both → pruned/gone; rawPath stays null (rely on the GLB).
  }
  // Whether a reoptimise has a source to read: the `modelPath` object (an
  // `.xbf.zst` counts — it re-tessellates). A pruned/dangling source means the
  // refresh affordance would only ever fail — the client hides it.
  const sourceAvailable = modelPath
    ? rawCandidate === modelPath
      ? rawPath !== null
      : (await exists(modelPath)) !== null
    : false;

  return {
    optimizedModelPath: model.data?.optimizedModelPath ?? null,
    // lodPath tier is pending (assembler single-draw LOD) — added in a later migration.
    lodPath: null as string | null,
    glbPath: model.data?.glbPath ?? null,
    thumbnailPath: model.data?.thumbnailPath ?? null,
    rawPath,
    rawBucket,
    // Whether the optimiser is configured at all. When false, the viewer hides
    // the "Optimize failed · Retry" affordance and never auto-fires an optimise —
    // retrying against a non-existent assembler just fails again.
    optimizerAvailable: Boolean(ASSEMBLER_SERVICE_URL),
    // Lets the client stop polling once optimisation lands (or fails).
    optimizeStatus: model.data?.optimizeStatus ?? null,
    // The reduction badge compares as-uploaded vs optimised bytes. `size` is
    // the STORED raw (rewritten to the .zst size after compaction), so prefer
    // the frozen originalSize; older rows fall back to size.
    size: model.data?.originalSize ?? model.data?.size ?? null,
    optimizedSize: model.data?.optimizedSize ?? null,
    // Cache-buster for the optimised GLB: it lives at a STABLE path behind an
    // immutable-cached preview URL, so a re-optimise would otherwise keep
    // serving the browser-cached old mesh.
    optimizedAt: model.data?.optimizedAt ?? null,
    sourceAvailable
  };
}
