// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["inspection"]
};

// The Inbound Inspections submodule was renamed to Inspections.
export async function loader({ request }: LoaderFunctionArgs) {
  const search = new URL(request.url).search;
  throw redirect(`${path.to.inspections}${search}`);
}
