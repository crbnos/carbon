import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { getAutodeskToken } from "~/lib/autodesk/autodesk.server";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  const autodesk = await getAutodeskToken();

  return json({
    token: autodesk.data?.token ?? null,
    expiresAt: autodesk.data?.expiresAt ?? Date.now(),
  });
}
