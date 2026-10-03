// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "@carbon/utils";
import { path } from "~/utils/path";

// Board was retired — it's plan-only now. Keep this path working (old links,
// bookmarks) by redirecting to the plan page.
export function loader() {
  return redirect(path.to.getStartedPage("plan"));
}
