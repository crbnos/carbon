import { notFound } from "@carbon/auth";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { ModelViewer } from "@carbon/viewer/wasm";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getPublicModelUrl } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
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

  return (
    <div className="w-screen h-screen bg-white p-0 m-0">
      <ModelViewer
        mode="light"
        key={model.modelPath}
        file={null}
        url={getPublicModelUrl(model.modelPath)}
        withProperties={false}
      />
    </div>
  );
}
