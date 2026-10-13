// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export const middleware = [redirectBeforeLoaders(loader)];

/** Settings → Timekeeping is now Settings → Time. The old URL keeps working. */
export async function loader(_args: LoaderFunctionArgs) {
  throw redirect(path.to.timeSettings);
}
