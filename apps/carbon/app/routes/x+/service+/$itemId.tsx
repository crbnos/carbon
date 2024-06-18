import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import {
  ServiceHeader,
  ServiceProperties,
  getBuyMethods,
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

  const [service, buyMethods, pickMethods] = await Promise.all([
    getService(client, itemId, companyId),
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
          <VStack spacing={2} className="p-2">
            <Outlet />
          </VStack>
        </div>
        <ServiceProperties />
      </div>
    </div>
  );
}
