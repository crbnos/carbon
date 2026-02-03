import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Purchasing RFQ" }];
};

export const handle: Handle = {
  breadcrumb: "Purchasing",
  to: path.to.purchasing,
  module: "purchasing"
};

export default function PurchasingRFQRoute() {
  return <Outlet />;
}
