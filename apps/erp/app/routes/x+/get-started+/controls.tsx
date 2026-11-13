// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { SetupControls } from "@carbon/onboarding/ui";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

const INTERNAL_DOMAINS = ["@carbon.us.org", "@carbon.ms"];

// Carbon-only page: hard-gate non-internal users server-side. State + mutations
// come from <HubProvider> in the layout.
export async function loader({ request }: LoaderFunctionArgs) {
  const { email } = await authorize(request);
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
