import { requirePermissions } from "@carbon/auth/auth.server";
import { getSlackInstallUrl } from "@carbon/integrations/slack";
import { json, type LoaderFunctionArgs } from "@vercel/remix";

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId, companyId } = await requirePermissions(request, {});

  const url = await getSlackInstallUrl({
    companyId,
    userId,
  });

  return json({ url });
}
