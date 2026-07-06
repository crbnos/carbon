import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Fixed Asset" }];
};

export const handle: Handle = {
  breadcrumb: "Accounting",
  to: path.to.fixedAssets,
  module: "accounting"
};

export default function FixedAssetLayout() {
  return <Outlet />;
}
