import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Inspection" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality"
  });

  return null;
}

export const handle: Handle = {
  breadcrumb: msg`Quality`,
  to: path.to.quality,
  module: "quality"
};

export default function InspectionRoute() {
  return <Outlet />;
}
