import { requirePermissions } from "@carbon/auth/auth.server";
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
      "size, optimizedSize, optimizedModelPath, glbPath, thumbnailPath, optimizeStatus"
    )
    .eq("id", modelUploadId)
    .eq("companyId", companyId)
    .maybeSingle();

  return {
    optimizedModelPath: model.data?.optimizedModelPath ?? null,
    // lodPath tier is pending (assembler single-draw LOD) — added in a later migration.
    lodPath: null as string | null,
    glbPath: model.data?.glbPath ?? null,
    thumbnailPath: model.data?.thumbnailPath ?? null,
    // Lets the client stop polling once optimisation lands (or fails).
    optimizeStatus: model.data?.optimizeStatus ?? null,
    // Raw source vs optimised bytes — the viewer shows the reduction.
    size: model.data?.size ?? null,
    optimizedSize: model.data?.optimizedSize ?? null
  };
}
