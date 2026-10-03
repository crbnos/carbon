// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunction } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

export const loader: LoaderFunction = async ({ request }) => {
  return redirect(path.to.operations);
};

export const middleware = [redirectBeforeLoaders(loader)];
