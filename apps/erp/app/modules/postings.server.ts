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
import { serverFns } from "@carbon/server-functions";

/** A posting still in `@carbon/server-functions`, called as its callers did:
 *  as the caller behind `client`, else as the system. */
function fromPackage<K extends PostingName>(name: K): Postings[K] {
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
  "update-purchased-prices": fromPackage("update-purchased-prices"),
  "kanban-replenish": fromPackage("kanban-replenish"),
  "create-rental-invoices": fromPackage("create-rental-invoices"),
  "create-contract-invoices": fromPackage("create-contract-invoices"),
  "create-lease-invoices": fromPackage("create-lease-invoices"),
  "propose-revenue-recognition-run": fromPackage(
    "propose-revenue-recognition-run"
  )
};
