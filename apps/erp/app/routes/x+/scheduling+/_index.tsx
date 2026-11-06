// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import { path } from "~/utils/path";

// /x/scheduling has no page of its own (it rendered an empty outlet with no
// heading): open its first section, the forecast board.
export async function loader() {
  throw redirect(path.to.scheduleForecast);
}

export const middleware = [redirectBeforeLoaders(loader)];
