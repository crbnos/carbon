// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// credit: Matt Aitken at trigger.dev
import { useLocation, useNavigation } from "react-router";

export function useOptimisticLocation() {
  const navigation = useNavigation();
  const location = useLocation();

  if (navigation.state === "idle" || !navigation.location) {
    return location;
  }

  return navigation.location;
}
