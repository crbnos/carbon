import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { getWorkCentersByLocation } from "~/services/jobs.service";
import { setLocationAndWorkCenter } from "~/services/location.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {});
  const formData = await request.formData();

  const currentLocation = formData.get("location");
  if (!currentLocation || typeof currentLocation !== "string") {
    return null;
  }

  const workCenters = await getWorkCentersByLocation(client, currentLocation);
  const workCenter = workCenters?.data?.[0]?.id ?? "";

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": setLocationAndWorkCenter(currentLocation, workCenter),
    },
  });
}
