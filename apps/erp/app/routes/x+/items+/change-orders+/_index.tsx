// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "react-router";
import { path } from "~/utils/path";

// Legacy URL shim: /x/items/change-orders → /x/items/change-notices
export async function loader() {
  throw redirect(path.to.changeNotices, 301);
}
