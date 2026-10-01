// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { DataMigrationView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout — the view
// reads them via hub hooks, so the route is just the mount point.
export default function GetStartedDataRoute() {
  return <DataMigrationView />;
}
