import { msg } from "@lingui/core/macro";
import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Workflow" }];
};

export const handle: Handle = {
  breadcrumb: msg`Workflows`,
  to: path.to.workflows,
  module: "workflows"
};

export default function WorkflowRoute() {
  return (
    <div className="h-full w-full bg-background">
      <Outlet />
    </div>
  );
}
