import { Outlet } from "@remix-run/react";
import type { MetaFunction } from "@vercel/remix";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Non-Conformance" }];
};

export const handle: Handle = {
  breadcrumb: "Quality",
  to: path.to.quality,
  module: "quality",
};

export default function NonConformanceRoute() {
  return <Outlet />;
}
