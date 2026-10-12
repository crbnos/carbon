// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { path } from "~/utils/path";

export async function loader({ params }: LoaderFunctionArgs) {
  const { transferId } = params;
  if (!transferId) throw new Error("transferId not found");

  // Redirect to create a new shipment with the warehouse transfer as the source document
  const url = path.to.newShipment;
  const searchParams = new URLSearchParams({
    sourceDocument: "Outbound Transfer",
    sourceDocumentId: transferId
  });

  throw redirect(`${url}?${searchParams.toString()}`);
}
