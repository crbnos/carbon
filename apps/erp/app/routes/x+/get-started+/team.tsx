// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { TeamView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedTeamRoute() {
  return <TeamView />;
}
