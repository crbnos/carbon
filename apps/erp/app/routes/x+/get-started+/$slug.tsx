// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { pageBySlug } from "@carbon/onboarding";
import { PlaceholderPage } from "@carbon/onboarding/ui";
import { useLingui } from "@lingui/react/macro";
import { useParams } from "react-router";

// Catch-all for hub pages not yet built (everything past Start Here in P1).
// A real route file (e.g. plan.tsx) takes precedence as each page ships.
export default function GetStartedPlaceholderRoute() {
  const { i18n } = useLingui();
  const { slug } = useParams();
  const page = slug ? pageBySlug(slug) : undefined;
  return (
    <PlaceholderPage title={page ? i18n._(page.title) : "Implementation Hub"} />
  );
}
