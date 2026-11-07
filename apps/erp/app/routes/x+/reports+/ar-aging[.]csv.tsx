// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllByIds, fetchAllRecords } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { agingCsvTable } from "~/modules/invoicing/invoicing.reports";
import {
  getArAging,
  getArOpenByCustomer
} from "~/modules/invoicing/invoicing.service";
import { agingCsvResponse, resolveAgingExportRequest } from "./aging.server";

const logger = getLogger("erp", "reports-ar-aging-csv");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, asOfDate, agingMethod, bucketDays } =
    await resolveAgingExportRequest(request);

  const [aging, open] = await Promise.all([
    fetchAllRecords(() =>
      getArAging(client, companyId, asOfDate, { agingMethod, bucketDays })
        .order("total", { ascending: false })
        .order("customerId")
    ),
    fetchAllRecords(() =>
      getArOpenByCustomer(client, companyId, asOfDate)
        .order("customerId")
        .order("dateDue", { nullsFirst: false })
        .order("documentId")
        .order("documentType")
    )
  ]);
  if (aging.error || open.error) {
    logger.error("Failed to export AR aging", {
      companyId,
      error: aging.error ?? open.error
    });
    throw new Response("AR aging could not be exported.", { status: 500 });
  }

  const customers = await fetchAllByIds(
    aging.data.map((a) => a.customerId),
    (ids) =>
      client
        .from("customer")
        .select("id, name")
        .eq("companyId", companyId)
        .in("id", ids)
        .order("id")
  );
  if (customers.error) {
    logger.error("Failed to read customers for AR aging export", {
      companyId,
      error: customers.error
    });
    throw new Response("AR aging could not be exported.", { status: 500 });
  }

  return agingCsvResponse(
    `ar-aging-${asOfDate}.csv`,
    agingCsvTable({
      partyHeader: "Customer",
      partyNameById: new Map(customers.data.map((c) => [c.id, c.name])),
      aging: aging.data.map((a) => ({ ...a, partyId: a.customerId })),
      open: open.data.map((d) => ({ ...d, partyId: d.customerId })),
      bucketDays,
      withSupplierReference: false
    })
  );
}
