import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// The reports hub lives inside the accounting module (with its sidebar);
// this namespace only hosts the full-screen report pages.
export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });
  throw redirect(path.to.reports);
}
