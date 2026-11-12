// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader(args: LoaderFunctionArgs) {
  const { itemId } = args.params;
  if (!itemId) throw new Error("itemId not found");

  const api = await carbon(args.request);
  return api.purchasing.getRequestQuoteRows({ itemId });
}
