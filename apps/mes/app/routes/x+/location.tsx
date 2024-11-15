import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { setLocationAndWorkCenter } from "~/services/location.server";
import { getWorkCentersByLocation } from "~/services/operations.service";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {});
  const formData = await request.formData();

  const currentLocation = formData.get("location");
  if (!currentLocation || typeof currentLocation !== "string") {
    return null;
  }

  const workCenters = await getWorkCentersByLocation(client, currentLocation);
  const workCenter = workCenters?.data?.[0]?.id ?? "";

  throw redirect(path.to.authenticatedRoot, {
    headers: {
      "Set-Cookie": setLocationAndWorkCenter(
        companyId,
        currentLocation,
        workCenter
      ),
    },
  });
}
