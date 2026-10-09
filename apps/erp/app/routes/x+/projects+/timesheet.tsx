// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// My Timesheet moved out of Projects to /x/timesheet. Keep the old address
// working, with its week.
export async function loader({ request }: LoaderFunctionArgs) {
  const { search } = new URL(request.url);
  throw redirect(`${path.to.timesheet}${search}`);
}

export const middleware = [redirectBeforeLoaders(loader)];
