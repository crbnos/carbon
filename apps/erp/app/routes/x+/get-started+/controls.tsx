import { requirePermissions } from "@carbon/auth/auth.server";
import { SetupControls } from "@carbon/onboarding/ui";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

const INTERNAL_DOMAINS = ["@carbon.us.org", "@carbon.ms"];

// Carbon-only page: hard-gate non-internal users server-side. State + mutations
// come from <HubProvider> in the layout.
export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await requirePermissions(request, {});
  const isInternal = INTERNAL_DOMAINS.some((domain) =>
    email.toLowerCase().trim().endsWith(domain)
  );
  if (!isInternal) {
    throw redirect(path.to.getStarted);
  }
  return null;
}

export default function GetStartedControlsRoute() {
  return <SetupControls />;
}
