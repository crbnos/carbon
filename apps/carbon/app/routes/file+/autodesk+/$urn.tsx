import { requirePermissions } from "@carbon/auth/auth.server";
import { AutodeskViewer } from "@carbon/react";
import { useLoaderData, useParams } from "@remix-run/react";
import { json, type LoaderFunctionArgs } from "@vercel/remix";
import { AutodeskProvider, useAutodeskToken } from "~/lib/autodesk";
import { getAutodeskToken } from "~/lib/autodesk/autodesk.server";
import { getModelUploadByUrn } from "~/modules/items";

export function links() {
  return [
    {
      rel: "stylesheet",
      href: "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css",
    },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {});

  const { urn } = params;
  if (!urn) throw new Error("Could not find urn");

  const [autodesk, uploadModel] = await Promise.all([
    getAutodeskToken(),
    getModelUploadByUrn(client, urn, companyId),
  ]);
  if (autodesk.error) {
    throw new Error("Failed to get Autodesk token: " + autodesk.error.message);
  }

  if (uploadModel.error) {
    throw new Error(
      "Access denied: Please verify that you are signed in as the company who owns this file"
    );
  }

  return json({ autodesk: autodesk.data });
}

export default function AutodeskUrnRoute() {
  const { autodesk } = useLoaderData<typeof loader>();
  const { urn } = useParams();
  if (!urn) throw new Error("Could not find urn");

  return (
    <AutodeskProvider token={autodesk}>
      <Viewer urn={urn} />
    </AutodeskProvider>
  );
}

function Viewer({ urn }: { urn: string }) {
  const { autodeskToken } = useAutodeskToken();
  return autodeskToken ? (
    <div className="w-screen h-screen bg-black p-2">
      <AutodeskViewer
        accessToken={autodeskToken}
        urn={urn}
        showDefaultToolbar
      />
    </div>
  ) : null;
}
