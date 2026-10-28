// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type BrowserFlagKey,
  type BrowserFlags,
  flagDefault
} from "@carbon/env/flags";
import { useRouteData } from "./useRouteData";

/**
 * The feature flags the authenticated layout loader (`/x`) evaluated for this
 * user and company. The ERP sends them; the MES sends none yet, so there
 * `feature(key)` answers the flag's registry default (`@carbon/env/flags`).
 */
export function useFeatureFlags() {
  const flags = useRouteData<{ flags?: BrowserFlags }>("/x")?.flags;
  return {
    feature: (key: BrowserFlagKey): boolean => flags?.[key] ?? flagDefault(key)
  };
}
