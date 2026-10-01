// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { ValueView } from "@carbon/onboarding/ui";

// State, flags, and mutations come from <HubProvider> in the layout.
export default function GetStartedValueRoute() {
  return <ValueView />;
}
