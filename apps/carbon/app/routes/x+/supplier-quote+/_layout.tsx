import { requirePermissions } from "@carbon/auth/auth.server";
import { json, Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Supplier Quote" }];
};

export const config = {
  runtime: "nodejs",
};

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.supplierQuotes,
  module: "purchasing",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing",
  });

  return json({});
}

export default function SupplierQuoteRoute() {
  return <Outlet />;
}
