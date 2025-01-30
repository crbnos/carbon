import { requirePermissions } from "@carbon/auth/auth.server";
import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Batch" }];
};

export const handle: Handle = {
  breadcrumb: "Inventory",
  to: path.to.inventory,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "inventory",
  });

  return null;
}

export default function BatchRoute() {
  return <Outlet />;
}
