// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirectBeforeLoaders } from "@carbon/utils";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export async function loader() {
  throw redirect(path.to.people);
}

export const middleware = [redirectBeforeLoaders(loader)];
