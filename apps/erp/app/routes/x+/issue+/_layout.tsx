import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Issue" }];
};

export const handle: Handle = {
  breadcrumb: "Quality",
  to: path.to.quality,
  module: "quality",
};

export default function IssueRoute() {
  return <Outlet />;
}
