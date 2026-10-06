// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { RouteRealtimeTable } from "@carbon/database/realtime-tables";
export type Handle = {
  breadcrumb?: any;
  to?: string;
  module?: string;
  // The tables this route shows. The shell (`RouteRealtime`) reloads the page
  // when one of them changes; each must be in REALTIME_TABLES.
  realtime?: RouteRealtimeTable[];
};
