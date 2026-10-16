// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The postings `@carbon/jobs` and `@carbon/ee` call, which cannot import the
// ERP (`@carbon/api/postings.server`). Registered by `carbon.server.ts`.

import type {
  PostingContract,
  PostingHandles,
  PostingName,
  Postings
} from "@carbon/api/postings.server";
import { type ServerFnName, serverFns } from "@carbon/server-functions";
import {
  replenishKanban,
  replenishKanbanPermission
} from "./inventory/inventory.service";
import {
  updatePurchasedPrices,
  updatePurchasedPricesPermission
} from "./purchasing/purchasing.service";
import {
  createRentalInvoices,
  createRentalInvoicesPermission
} from "./sales/sales.service";
import { invokePosting } from "./shared/shared.service";

/** A posting still in `@carbon/server-functions`, called as its callers did:
 *  as the caller behind `client`, else as the system. */
function fromPackage<K extends PostingName & ServerFnName>(
  name: K
): Postings[K] {
  return ((handles: PostingHandles, input: PostingContract[K]["input"]) => {
    const { client, ...fields } = handles;
    const invoker = client
      ? serverFns.as({ ...fields, client })
      : serverFns.system(fields);
    return invoker.invoke(name, input as never);
  }) as Postings[K];
}

export const postings: Postings = {
  "post-sales-invoice": fromPackage("post-sales-invoice"),
  "post-purchase-invoice": fromPackage("post-purchase-invoice"),
  "post-receipt": fromPackage("post-receipt"),
  "post-shipment": fromPackage("post-shipment"),
  "post-payment": fromPackage("post-payment"),
  "post-charge": fromPackage("post-charge"),
  "update-purchased-prices": (handles, input) =>
    invokePosting(
      handles,
      "update-purchased-prices",
      input,
      updatePurchasedPrices,
      {
        as: updatePurchasedPricesPermission
      }
    ),
  "kanban-replenish": (handles, input) =>
    invokePosting(handles, "kanban-replenish", input, replenishKanban, {
      as: replenishKanbanPermission
    }),
  "create-rental-invoices": (handles, input) =>
    invokePosting(
      handles,
      "create-rental-invoices",
      input,
      createRentalInvoices,
      {
        as: createRentalInvoicesPermission
      }
    ),
  "create-contract-invoices": fromPackage("create-contract-invoices"),
  "create-lease-invoices": fromPackage("create-lease-invoices"),
  "propose-revenue-recognition-run": fromPackage(
    "propose-revenue-recognition-run"
  )
};
