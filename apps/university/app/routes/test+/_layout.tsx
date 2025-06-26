import { Outlet } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";

import { getAuthSession } from "@carbon/auth/session.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await getAuthSession(request);

  if (!session) {
    throw redirect(path.to.login);
  }

  return null;
}

export default function AuthenticatedRoute() {
  return <Outlet />;
}
