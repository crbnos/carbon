// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { CSV_CONTENT_TYPE, encodeCsvTable } from "@carbon/files/csv";
import { getLogger } from "@carbon/logger";
import type { LoaderFunctionArgs } from "react-router";
import {
  getApAging,
  getApOpenBySupplier
} from "~/modules/invoicing/invoicing.service";
import { resolveApAgingRequest } from "./ap-aging.server";

const logger = getLogger("erp", "reports-ap-aging-csv");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, asOfDate, agingMethod, bucketDays } =
    await resolveApAgingRequest(request);
  const [b1, b2, b3] = bucketDays;

  const [aging, open] = await Promise.all([
    getApAging(client, companyId, asOfDate, { agingMethod, bucketDays }),
    getApOpenBySupplier(client, companyId, asOfDate)
  ]);
  if (aging.error || open.error) {
    logger.error("Failed to export AP aging", {
      companyId,
      error: aging.error ?? open.error
    });
    throw new Response("AP aging could not be exported.", { status: 500 });
  }

  const suppliers = await client
    .from("supplier")
    .select("id, name")
    .eq("companyId", companyId)
    .in(
      "id",
      aging.data.map((a) => a.supplierId)
    );
  if (suppliers.error) {
    logger.error("Failed to read suppliers for AP aging export", {
      companyId,
      error: suppliers.error
    });
    throw new Response("AP aging could not be exported.", { status: 500 });
  }
  const nameById = new Map(suppliers.data.map((s) => [s.id, s.name]));

  const invoicesBySupplier = new Map<string, typeof open.data>();
  for (const inv of open.data) {
    const list = invoicesBySupplier.get(inv.supplierId) ?? [];
    list.push(inv);
    invoicesBySupplier.set(inv.supplierId, list);
  }

  const rows = aging.data.flatMap((a) => [
    [
      nameById.get(a.supplierId) ?? a.supplierId,
      "",
      "",
      a.paymentTerm,
      a.current,
      a.bucket1,
      a.bucket2,
      a.bucket3,
      a.bucket4,
      a.unapplied,
      a.total
    ],
    ...(invoicesBySupplier.get(a.supplierId) ?? []).map((inv) => [
      inv.documentNumber,
      inv.supplierReference,
      inv.dateDue,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      inv.openInBase
    ])
  ]);

  const csv = encodeCsvTable(
    [
      "Supplier",
      "Vendor Invoice #",
      "Due Date",
      "Payment Term",
      "Current",
      `1-${b1}`,
      `${b1 + 1}-${b2}`,
      `${b2 + 1}-${b3}`,
      `${b3}+`,
      "Unapplied",
      "Total"
    ],
    rows.map((row) => row.map((cell) => cell ?? ""))
  );

  return new Response(csv, {
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="ap-aging-${asOfDate}.csv"`
    }
  });
}
