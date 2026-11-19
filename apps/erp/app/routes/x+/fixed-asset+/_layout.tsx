// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet } from "@carbon/react";
import { msg } from "@lingui/core/macro";

import type { Handle } from "~/utils/handle";
import { moduleMeta } from "~/utils/meta";
import { path } from "~/utils/path";

export { RouteErrorBoundary as ErrorBoundary } from "@carbon/react/ErrorBoundary";

export const meta = moduleMeta("Fixed Asset");

export const handle: Handle = {
  breadcrumb: msg`Accounting`,
  to: path.to.fixedAssets,
  module: "accounting"
};

export default function FixedAssetLayout() {
  return <RecordOutlet />;
}
