// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { projectId } = params;
  if (!projectId) throw new Error("Could not find projectId");
  throw redirect(path.to.projectElements(projectId));
}

export const middleware = [redirectBeforeLoaders(loader)];
