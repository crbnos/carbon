import { msg } from "@lingui/core/macro";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Reports`,
  to: path.to.reports,
  module: "accounting"
};

// Full-screen namespace: no module sidebar — reports render full-width inside
// the app shell. `h-full` (not `flex-1`) because the parent <main> is a block,
// not a flex container, so flex-1 collapses to auto height — which zeroes out
// the virtualized Table body in the aging reports (the tree reports self-size
// via their own calc height, so they were unaffected either way).
export default function ReportsRoute() {
  return (
    <div className="h-full bg-card">
      <Outlet />
    </div>
  );
}
