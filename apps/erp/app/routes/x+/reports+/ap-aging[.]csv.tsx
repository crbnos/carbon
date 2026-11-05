// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { fetchAllByIds, fetchAllRecords } from "@carbon/database";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import { agingCsvTable } from "~/modules/invoicing/invoicing.reports";
import {
  getApAging,
  getApOpenBySupplier
} from "~/modules/invoicing/invoicing.service";
import { agingCsvResponse, resolveAgingExportRequest } from "./aging.server";

const logger = getLogger("erp", "reports-ap-aging-csv");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, asOfDate, agingMethod, bucketDays } =
    await resolveAgingExportRequest(request);

  const [aging, open] = await Promise.all([
    fetchAllRecords(() =>
      getApAging(client, companyId, asOfDate, { agingMethod, bucketDays })
        .order("total", { ascending: false })
        .order("supplierId")
    ),
    fetchAllRecords(() =>
      getApOpenBySupplier(client, companyId, asOfDate)
        .order("supplierId")
        .order("dateDue", { nullsFirst: false })
        .order("documentId")
        .order("documentType")
    )
  ]);
  if (aging.error || open.error) {
    logger.error("Failed to export AP aging", {
      companyId,
      error: aging.error ?? open.error
    });
    throw new Response("AP aging could not be exported.", { status: 500 });
  }

  const suppliers = await fetchAllByIds(
    aging.data.map((a) => a.supplierId),
    (ids) =>
      client
        .from("supplier")
        .select("id, name")
        .eq("companyId", companyId)
        .in("id", ids)
        .order("id")
  );
  if (suppliers.error) {
    logger.error("Failed to read suppliers for AP aging export", {
      companyId,
      error: suppliers.error
    });
    throw new Response("AP aging could not be exported.", { status: 500 });
  }

  return agingCsvResponse(
    `ap-aging-${asOfDate}.csv`,
    agingCsvTable({
      partyHeader: "Supplier",
      partyNameById: new Map(suppliers.data.map((s) => [s.id, s.name])),
      aging: aging.data.map((a) => ({ ...a, partyId: a.supplierId })),
      open: open.data.map((d) => ({ ...d, partyId: d.supplierId })),
      bucketDays,
      withSupplierReference: true
    })
  );
}
