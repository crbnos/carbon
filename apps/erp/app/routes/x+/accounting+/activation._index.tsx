// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect, redirectBeforeLoaders } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

/** The wizard opens on its first step, keeping a chosen cutover date. */
export async function loader({ request }: LoaderFunctionArgs) {
  const { search } = new URL(request.url);
  throw redirect(`${path.to.accountingActivationStep("readiness")}${search}`);
}

export const middleware = [redirectBeforeLoaders(loader)];
