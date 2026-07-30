import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Change Notice" }];
};

export const handle: Handle = {
  breadcrumb: msg`Change Notices`,
  to: path.to.changeNotices,
  module: "items"
};

export default function ChangeNoticeRoute() {
  return <Outlet />;
}
