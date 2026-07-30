import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ModelCanvas } from "@carbon/viewer/canvas";
import { useState } from "react";
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
  // No raw-STEP tessellation path — the assembler produces the GLB. This route is
  // rendered headlessly by the model-thumbnail edge function, which waits for the
  // `#model-viewer-canvas` marker before screenshotting.
  const glbPath = model.optimizedModelPath ?? model.glbPath;
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative h-screen w-screen bg-white">
      {glbPath ? (
        <>
          {/* Chrome-less: the thumbnail screenshot wants just the model. */}
          <ModelCanvas
            key={glbPath}
            glbUrl={getPublicModelUrl(glbPath)}
            mode="light"
            viewCube={false}
            interactive={false}
            onLoaded={() => setLoaded(true)}
          />
          {/* The thumbnail edge fn `waitForSelector("#model-viewer-canvas")`
              before capturing — render it only once the model has framed, so it
              screenshots a ready model, not a blank/loading frame. */}
          {loaded && (
            <div
              id="model-viewer-canvas"
              className="pointer-events-none absolute inset-0"
            />
          )}
        </>
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
