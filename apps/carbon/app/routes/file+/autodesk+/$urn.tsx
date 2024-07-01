import { AutodeskViewer } from "@carbon/react";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useParams } from "@remix-run/react";
import { AutodeskProvider, useAutodeskToken } from "~/lib/autodesk";
import { getAutodeskToken } from "~/lib/autodesk/autodesk.server";
import { requirePermissions } from "~/services/auth/auth.server";

export function links() {
  return [
    {
      rel: "stylesheet",
      href: "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css",
    },
  ];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {});

  const { urn } = params;
  if (!urn) throw new Error("Could not find urn");

  const autodesk = await getAutodeskToken();
  if (autodesk.error) {
    throw new Error("Failed to get Autodesk token: " + autodesk.error.message);
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
