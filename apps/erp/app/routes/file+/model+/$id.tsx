import { ModelViewer } from "@carbon/react";
import { json, useLoaderData } from "@remix-run/react";

import { getCarbonServiceRole, notFound } from "@carbon/auth";
import type { LoaderFunctionArgs } from "@vercel/remix";
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

  return json({ model: model.data });
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
