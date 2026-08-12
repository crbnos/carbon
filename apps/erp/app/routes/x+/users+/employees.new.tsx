import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Single invite flow: the multi-row bulk invite modal covers one or many.
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "users"
  });

  const url = new URL(request.url);
  throw redirect(`${path.to.bulkInviteEmployees}${url.search}`);
}
