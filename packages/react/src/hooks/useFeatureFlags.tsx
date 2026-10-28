// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import {
  type BrowserFlagKey,
  type BrowserFlags,
  type FlagValue,
  flagDefault
} from "@carbon/env/flags";
import { useRouteData } from "./useRouteData";

/**
 * The feature flags the authenticated layout loader (`/x`, in the ERP and the
 * MES) evaluated for this user and company. `feature(key)` falls back to the
 * flag's registry default (`@carbon/env/flags`).
 */
export function useFeatureFlags() {
  const flags = useRouteData<{ flags?: BrowserFlags }>("/x")?.flags;
  return {
    feature: <K extends BrowserFlagKey>(key: K): FlagValue<K> =>
      (flags?.[key] as FlagValue<K> | undefined) ?? flagDefault(key)
  };
}
