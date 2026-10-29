// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.employeeAccounts);
}

export const middleware = [redirectBeforeLoaders(loader)];
