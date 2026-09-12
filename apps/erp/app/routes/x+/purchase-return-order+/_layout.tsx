import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Purchase Return Order" }];
};

export const handle: Handle = {
  breadcrumb: msg`Purchasing`,
  to: path.to.purchasing,
  module: "purchasing"
};

export default function PurchaseReturnOrderRoute() {
  return <Outlet />;
}
