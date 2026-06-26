import { requirePermissions } from "@carbon/auth/auth.server";
import { PositioningView } from "@carbon/onboarding/ui";
import { isInternalEmail } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

// Carbon-only positioning page — hard-gate non-internal users server-side.
export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await requirePermissions(request, {});
  if (!isInternalEmail(email)) {
    throw redirect(path.to.getStarted);
  }
  return null;
}

export default function GetStartedPositioningRoute() {
  return <PositioningView />;
}
