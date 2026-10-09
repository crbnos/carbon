// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import type { ServiceEstimate } from "@carbon/documents/pdf";
import { ensureFont, ServiceEstimatePDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import {
  datetime,
  formatDate,
  formatMoney,
  formatQuantity,
  getPreferenceHeaders
} from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting";
import {
  buildServiceEstimate,
  formatSiteAddress,
  getServiceEstimateInputs,
  getServiceOrder
} from "~/modules/service";
import { getCompany } from "~/modules/settings";

const logger = getLogger("erp", "service-estimate", "pdf");

/** The settlement decimals when the currency row is missing. */
const FALLBACK_DECIMALS = 2;

/**
 * A service order's estimate as a PDF: the work tree in order with each
 * node's plan lines at sale prices (`buildServiceEstimate`), the customer,
 * the site, the unit and its warranty.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "service" }
  );
  const { id } = params;
  if (!id) throw new Error("Could not find service order id");

  const [company, order] = await Promise.all([
    getCompany(client, companyId),
    getServiceOrder(client, id, companyId)
  ]);
  if (company.error || order.error || !company.data || !order.data) {
    logger.error("Failed to load the service order for its estimate", {
      companyId,
      serviceOrderId: id,
      error: company.error ?? order.error
    });
    throw new Response("The service order could not be found", {
      status: 404
    });
  }

  const [inputs, site, currency, timeZone] = await Promise.all([
    getServiceEstimateInputs(client, order.data.projectId, companyId),
    order.data.customerLocationId
      ? client
          .from("customerLocation")
          .select(
            "address:address!customerLocation_addressId_fkey(addressLine1, city, stateProvince, postalCode)"
          )
          .eq("id", order.data.customerLocationId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    getCurrencyByCode(client, companyGroupId, company.data.baseCurrencyCode),
    getCompanyTimeZone(client, companyId)
  ]);
  if (inputs.error || !inputs.data) {
    logger.error("Failed to load the estimate of a service order", {
      companyId,
      serviceOrderId: id,
      error: inputs.error
    });
    throw new Response("The estimate could not be loaded", { status: 500 });
  }

  const { locale } = getPreferenceHeaders(request);
  const currencyCode = company.data.baseCurrencyCode;
  const decimals = currency.data?.decimalPlaces ?? FALLBACK_DECIMALS;
  const money = (value: number) =>
    formatMoney(value, locale, currencyCode, decimals);
  const date = (value: string | null) =>
    value ? formatDate(value, undefined, locale) : null;

  const built = buildServiceEstimate({
    ...inputs.data,
    laborUnit: "HR"
  });
  const asset = order.data.customerAsset;
  const estimate: ServiceEstimate = {
    serviceOrderId: order.data.serviceOrderId,
    date: date(datetime.today(timeZone).toString()) ?? "",
    customerName: order.data.customer?.name ?? null,
    siteName: order.data.customerLocation?.name ?? null,
    siteAddress: formatSiteAddress(site?.data?.address),
    itemName:
      [order.data.item?.readableIdWithRevision, order.data.item?.name]
        .filter(Boolean)
        .join(" ") || null,
    serial: order.data.trackedEntity?.readableId ?? null,
    laborWarranty: date(asset?.laborWarrantyEndDate ?? null),
    partsWarranty: date(asset?.partsWarrantyEndDate ?? null),
    nodes: built.nodes.map((node) => ({
      id: node.id,
      depth: node.depth,
      readableId: node.readableId,
      name: node.name,
      isFixedPrice: node.isFixedPrice,
      total: node.lines.length > 0 ? money(node.total) : "",
      lines: node.lines.map((line) => ({
        description: line.description,
        quantity:
          line.quantity === null
            ? ""
            : `${formatQuantity(line.quantity, locale)}${
                line.unitOfMeasure ? ` ${line.unitOfMeasure}` : ""
              }`,
        unitPrice: line.unitPrice === null ? "" : money(line.unitPrice),
        amount: money(line.amount)
      }))
    })),
    total: money(built.total)
  };

  await ensureFont();
  const stream = await renderToStream(
    <ServiceEstimatePDF company={company.data as any} estimate={estimate} />
  );
  const body: Buffer = await new Promise((resolve, reject) => {
    const buffers: Uint8Array[] = [];
    stream.on("data", (data) => {
      buffers.push(data);
    });
    stream.on("end", () => {
      resolve(Buffer.concat(buffers));
    });
    stream.on("error", reject);
  });

  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="${company.data.name} - Estimate ${order.data.serviceOrderId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
