import { VStack } from "@carbon/react";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ServiceHeader,
  ServiceProperties,
  getBuyMethods,
  getItemFiles,
  getPickMethods,
  getService,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export const handle: Handle = {
  breadcrumb: "Services",
  to: path.to.services,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
  });

  const { itemId } = params;
  if (!itemId) throw new Error("Could not find itemId");

  const [service, files, buyMethods, pickMethods] = await Promise.all([
    getService(client, itemId, companyId),
    getItemFiles(client, itemId, companyId),
    getBuyMethods(client, itemId, companyId),
    getPickMethods(client, itemId, companyId),
  ]);

  if (service.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(service.error, "Failed to load service"))
    );
  }

  return json({
    service: service.data,
    files: files.data ?? [],
    buyMethods: buyMethods.data ?? [],
    pickMethods: pickMethods.data ?? [],
  });
}

export default function ServiceRoute() {
  return (
    <div className="flex flex-col h-[calc(100vh-49px)] w-full">
      <ServiceHeader />
      <div className="flex h-[calc(100vh-99px)] w-full">
        <div className="flex h-full w-full overflow-y-auto">
          <VStack spacing={2} className="p-2 w-full h-full">
            <Outlet />
          </VStack>
        </div>
        <ServiceProperties />
      </div>
    </div>
  );
}
