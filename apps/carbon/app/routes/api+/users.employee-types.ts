import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getEmployeeTypes } from "~/modules/users";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
  });

  return json(await getEmployeeTypes(client, companyId));
}
