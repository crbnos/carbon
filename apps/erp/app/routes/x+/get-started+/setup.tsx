// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { SetupMapView } from "@carbon/onboarding/ui";
import { useScrollToHash } from "~/hooks";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedSetupRoute() {
  // Scroll to (and briefly highlight) the group section deep-linked from a
  // Configure task in the Plan view.
  useScrollToHash();

  return <SetupMapView />;
}
