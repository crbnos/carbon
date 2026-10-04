// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useRealtimeTable } from "@carbon/query";

// Live-sync the Implementation Hub both directions: any change by Carbon staff or
// the customer's own users re-runs the hub loaders for every open client.
export function useImplementationRealtime(companyId: string) {
  useRealtimeTable({ companyId, table: "implementationHub" });
  useRealtimeTable({ companyId, table: "implementationCheckState" });
  useRealtimeTable({ companyId, table: "implementationFieldValue" });
  useRealtimeTable({ companyId, table: "implementationRow" });
}
