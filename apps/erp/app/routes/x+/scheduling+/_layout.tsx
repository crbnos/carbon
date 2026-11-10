// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { ProductionSections } from "~/modules/production/ui/useProductionSubmodules";
import type { Handle } from "~/utils/handle";
import { moduleMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta = moduleMeta("Schedule");

export const handle: Handle = {
  realtime: ["job", "jobOperation"],
  breadcrumb: msg`Production`,
  to: path.to.production,
  module: "production",
  // Phones: this route is a section of its module, so it gets the module's
  // section switcher there (desktop shows no sidebar here, unchanged).
  compactSidebar: ProductionSections
};

export default function SchedulingRoute() {
  return <RecordOutlet />;
}
