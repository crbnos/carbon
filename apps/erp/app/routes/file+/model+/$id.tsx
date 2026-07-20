import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ModelCanvas } from "@carbon/viewer/canvas";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getPublicModelUrl } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const client = getCarbonServiceRole();
  const { id } = params;
  if (!id) throw notFound("id not found");

  const model = await client
    .from("modelUpload")
    .select("*")
    .eq("id", id)
    .single();
  if (!model.data) throw notFound("model not found");

  return { model: model.data };
}

export default function ModelRoute() {
  const { model } = useLoaderData<typeof loader>();
  // Prefer the compact optimised GLB, fall back to the lossless assembly GLB.
  // No raw-STEP tessellation path — the assembler produces the GLB.
  const glbPath = model.optimizedModelPath ?? model.glbPath;

  return (
    <div className="h-screen w-screen bg-white">
      {glbPath ? (
        <ModelCanvas
          key={glbPath}
          glbUrl={getPublicModelUrl(glbPath)}
          mode="light"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <p className="text-sm text-muted-foreground">
            3D preview unavailable
          </p>
        </div>
      )}
    </div>
  );
}
