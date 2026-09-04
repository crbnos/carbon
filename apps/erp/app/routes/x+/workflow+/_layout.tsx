import type { MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Workflow" }];
};

// No breadcrumb here: the detail route ($id.tsx) already emits the "Workflows"
// list link via detailBreadcrumb, so declaring it on the layout too would render
// "Workflows" twice. `module` is kept for navigation highlighting / recently-viewed.
export const handle: Handle = {
  module: "workflows"
};

export default function WorkflowRoute() {
  return (
    <div className="h-full w-full bg-background">
      <Outlet />
    </div>
  );
}
