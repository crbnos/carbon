import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Depreciation Run" }];
};

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.depreciationRuns,
  module: "accounting"
};

export default function DepreciationRunLayout() {
  return <Outlet />;
}
