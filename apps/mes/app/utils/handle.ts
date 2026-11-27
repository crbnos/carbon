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
  // The ERP page of the record on screen, for "Back to ERP"; the deepest route's wins.
  erpLink?: (route: {
    params: Record<string, string | undefined>;
    data: any;
  }) => string | undefined;
};

/** Dispatches on the operation's work center: a block starting or ending turns Start off or on. */
export const operationMaintenanceRealtime: RouteRealtimeTable = {
  table: "maintenanceDispatch",
  filter: ({ data }) =>
    data?.operation?.workCenterId
      ? `workCenterId=eq.${data.operation.workCenterId}`
      : false
};
