import { AutodeskProvider, AutodeskViewer } from "@carbon/react";
import { useParams } from "@remix-run/react";
import { path } from "~/utils/path";

export function links() {
  return [
    {
      rel: "stylesheet",
      href: "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css",
    },
  ];
}

export default function AutodeskUrnRoute() {
  const { urn } = useParams();
  if (!urn) throw new Error("Could not find urn");

  return (
    <div className="w-screen h-screen bg-black p-2">
      <AutodeskProvider tokenEndpoint={path.to.api.autodeskToken}>
        <AutodeskViewer urn={urn} />
      </AutodeskProvider>
    </div>
  );
}
