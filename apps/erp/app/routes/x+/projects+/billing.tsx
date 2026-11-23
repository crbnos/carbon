// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export const middleware = [redirectBeforeLoaders(loader)];

/**
 * Billing review moved into Approvals as its Billing tab. The old URL keeps
 * working, with its filters.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const searchParams = new URL(request.url).searchParams;
  searchParams.set("tab", "billing");
  throw redirect(`${path.to.projectTimesheetApprovals}?${searchParams}`);
}
