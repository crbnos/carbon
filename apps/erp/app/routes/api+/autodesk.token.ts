import { requirePermissions } from "@carbon/auth/auth.server";
import { getAutodeskToken } from "@carbon/auth/autodesk.server";
import { json, type LoaderFunctionArgs } from "@vercel/remix";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {});
  const autodesk = await getAutodeskToken();

  return json({
    token: autodesk.data?.token ?? null,
    expiresAt: autodesk.data?.expiresAt ?? Date.now(),
  });
}
