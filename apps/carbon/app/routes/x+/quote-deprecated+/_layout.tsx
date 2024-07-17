import type { MetaFunction } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Quotation" }];
};

export const handle: Handle = {
  breadcrumb: "Sales",
  to: path.to.quotes,
  module: "sales",
};

export default function QuotationRoute() {
  return <Outlet />;
}
