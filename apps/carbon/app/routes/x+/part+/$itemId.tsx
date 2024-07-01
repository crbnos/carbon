import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useMatches } from "@remix-run/react";
import {
  PartHeader,
  PartProperties,
  getBuyMethods,
  getModelUploadByItemId,
  getPart,
  getPickMethods,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Parts",
  to: path.to.parts,
  module: "parts",
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [partSummary, modelUpload, buyMethods, pickMethods] = await Promise.all(
    [
      getPart(client, itemId, companyId),
      getModelUploadByItemId(client, itemId, companyId),
      getBuyMethods(client, itemId, companyId),
      getPickMethods(client, itemId, companyId),
    ]
  );

  if (partSummary.error) {
    throw redirect(
      path.to.items,
      await flash(
        request,
        error(partSummary.error, "Failed to load part summary")
      )
    );
  }

  return json({
    partSummary: partSummary.data,
    modelUpload: modelUpload.data,
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function PartRoute() {
  const matches = useMatches();
  const isManufacturing = matches.some(
    (match) => match.id === "routes/x+/part+/$itemId.manufacturing"
  );

  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <PartHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <Outlet />
        </div>
        {!isManufacturing && <PartProperties />}
      </div>
    </div>
  );
}
