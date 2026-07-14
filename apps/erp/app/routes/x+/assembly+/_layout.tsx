import { requirePermissions } from "@carbon/auth/auth.server";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Outlet } from "react-router";
import { requireAssembliesInternal } from "~/modules/production/production.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Assembly" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await requirePermissions(request, {
    view: "production"
  });
  requireAssembliesInternal(email);

  return null;
}

export const handle: Handle = {
  breadcrumb: msg`Production`,
  to: path.to.production,
  module: "production"
};

export default function AssemblyRoute() {
  return <Outlet />;
}
