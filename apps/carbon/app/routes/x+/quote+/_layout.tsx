import { requirePermissions } from "@carbon/auth/auth.server";
import { json, Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Quote" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.sales,
  module: "sales",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
  });

  return json({});
}

export default function QuoteRoute() {
  return <Outlet />;
}
