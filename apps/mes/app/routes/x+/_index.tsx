import { requirePermissions } from "@carbon/auth/auth.server";
import type { LoaderFunction } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getLocationAndWorkCenter } from "~/services/location.server";
import { path } from "~/utils/path";

export const loader: LoaderFunction = async ({ request }) => {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const [, workCenter] = await getLocationAndWorkCenter(request, client, {
    companyId,
    userId,
  });

  return redirect(path.to.jobs(workCenter));
};
