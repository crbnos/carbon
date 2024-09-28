import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getWorkCentersByLocation } from "~/services/jobs";
import { setLocationAndWorkCenter } from "~/services/location.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {});
  const formData = await request.formData();

  const location = formData.get("location");
  if (!location || typeof location !== "string") {
    return null;
  }

  const workCenters = await getWorkCentersByLocation(client, location);
  const workCenter = workCenters?.data?.[0]?.id ?? "";

  throw redirect(path.to.authenticatedRoot, {
    headers: { "Set-Cookie": setLocationAndWorkCenter(location, workCenter) },
  });
}
