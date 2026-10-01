// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "react-router";
import { path } from "~/utils/path";

// Legacy URL shim: /x/change-order/new → /x/change-notice/new
export async function loader() {
  throw redirect(path.to.newChangeNotice, 301);
}
