import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Document Templates" }];
};

export const handle: Handle = {
  breadcrumb: msg`Templates`,
  to: path.to.documentTemplates,
  module: "settings"
};

export default function TemplatesRoute() {
  return (
    <div className="h-full w-full bg-background">
      <Outlet />
    </div>
  );
}
