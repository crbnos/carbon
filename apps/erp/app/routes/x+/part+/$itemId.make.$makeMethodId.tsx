// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/** The old sub-assembly page. Its links now open the Bill of Material tab. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, { view: "parts" });

  const { itemId, makeMethodId } = params;
  if (!itemId) throw new Error("Could not find itemId");
  if (!makeMethodId) throw new Error("Could not find makeMethodId");

  const search = new URL(request.url).searchParams;
  search.set("makeMethodId", makeMethodId);
  throw redirect(`${path.to.partBillOfMaterial(itemId)}?${search.toString()}`);
}

export const middleware = [redirectBeforeLoaders(loader)];
