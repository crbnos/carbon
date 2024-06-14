import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { ServiceHeader, ServiceNavigation, getService } from "~/modules/items";
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

  const [service] = await Promise.all([getService(client, itemId, companyId)]);

  if (service.error) {
    throw redirect(
      path.to.items,
      await flash(request, error(service.error, "Failed to load service"))
    );
  }

  return json({
    service: service.data,
  });
}

export default function ServiceRoute() {
  return (
    <>
      <ServiceHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4">
        <ServiceNavigation />
        <Outlet />
      </div>
    </>
  );
}
