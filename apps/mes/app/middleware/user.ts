import { requirePermissions } from "@carbon/auth/auth.server";
import type { MiddlewareFunction } from "react-router";
import { redirect } from "react-router";
import { userContext } from "~/context";
import { getLocation, setLocation } from "~/services/location.server";
import { path } from "~/utils/path";

export const userMiddleware: MiddlewareFunction = async ({
  context,
  request
}) => {
  const { client, companyId, userId } = await requirePermissions(request, {});
  const { location, updated } = await getLocation(request, client, {
    companyId,
    userId
  });

  context.set(userContext, {
    locationId: location,
    companyId
  });

  if (updated) {
    return redirect(path.to.authenticatedRoot, {
      headers: {
        "Set-Cookie": setLocation(companyId, location)
      }
    });
  }
};
