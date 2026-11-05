// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import { path } from "~/utils/path";

// Projects moved to their own module; keep old links working.
export async function loader() {
  throw redirect(path.to.projects);
}

export const middleware = [redirectBeforeLoaders(loader)];
