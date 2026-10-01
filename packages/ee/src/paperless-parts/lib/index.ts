// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { PaperlessPartsClient } from "./client";

export {
  createPartFromComponent,
  getCarbonOrderStatus,
  getCustomerIdAndContactId,
  getCustomerLocationIds,
  getEmployeeAndSalesPersonId,
  getOrCreatePart,
  getOrderLocationId,
  getPaperlessPart,
  insertOrderLines,
  insertQuoteLines
} from "./lib";
export { OrderSchema } from "./schemas";

export async function getPaperlessParts(apiKey: string) {
  const client = new PaperlessPartsClient(apiKey);
  return client;
}
