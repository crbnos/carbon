import { json, Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@vercel/remix";
import { requirePermissions } from "~/services/auth/auth.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const meta: MetaFunction = () => {
  return [{ title: "Carbon | Jobs" }];
};

export const handle: Handle = {
  breadcrumb: "Production",
  to: path.to.production,
  module: "production",
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "production",
  });

  return json({});
}

export default function JobRoute() {
  return <Outlet />;
}
