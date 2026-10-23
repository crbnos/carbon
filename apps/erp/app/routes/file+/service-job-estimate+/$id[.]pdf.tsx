// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCompanyTimeZone } from "@carbon/database";
import type { ServiceJobEstimate } from "@carbon/documents/pdf";
import { ensureFont, ServiceJobEstimatePDF } from "@carbon/documents/pdf";
import { getLogger } from "@carbon/logger";
import {
  DEFAULT_CURRENCY_DECIMALS,
  datetime,
  formatDate,
  formatMoney,
  formatQuantity,
  getPreferenceHeaders,
  rateFormatOptions
} from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCurrencyByCode } from "~/modules/accounting/accounting.service";
import {
  getServiceJob,
  getServiceJobEstimateLines
} from "~/modules/service/service.service";
import { getCompany } from "~/modules/settings/settings.service";

const logger = getLogger("erp", "service-job-estimate", "pdf");

/**
 * A service job's estimate as a PDF: its estimate lines at their prices, the
 * customer, the site, the unit and its warranty. Amounts are in the company's
 * base currency.
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    { view: "service" }
  );
  const { id } = params;
  if (!id) throw new Error("Could not find service job id");

  const [company, job, lines] = await Promise.all([
    getCompany(client, companyId),
    getServiceJob(client, id),
    getServiceJobEstimateLines(client, id)
  ]);
  if (
    company.error ||
    job.error ||
    lines.error ||
    !company.data ||
    !job.data ||
    job.data.companyId !== companyId
  ) {
    logger.error("Failed to load the service job for its estimate", {
      companyId,
      serviceJobId: id,
      error: company.error ?? job.error ?? lines.error
    });
    throw new Response("The service job could not be found", { status: 404 });
  }

  const [site, currency, timeZone] = await Promise.all([
    job.data.customerLocationId
      ? client
          .from("customerLocation")
          .select(
            "name, address:address!customerLocation_addressId_fkey(addressLine1, city, stateProvince, postalCode)"
          )
          .eq("id", job.data.customerLocationId)
          .eq("companyId", companyId)
          .maybeSingle()
      : null,
    getCurrencyByCode(client, companyGroupId, company.data.baseCurrencyCode),
    getCompanyTimeZone(client, companyId)
  ]);

  const { locale } = getPreferenceHeaders(request);
  const currencyCode = company.data.baseCurrencyCode;
  const decimals = currency.data?.decimalPlaces ?? DEFAULT_CURRENCY_DECIMALS;
  const money = (value: number) =>
    formatMoney(value, locale, currencyCode, decimals);
  // A unit price is a rate: it keeps the digits past the currency's own.
  const price = new Intl.NumberFormat(
    locale,
    rateFormatOptions(currencyCode, decimals)
  );
  const date = (value: string | null) =>
    value ? formatDate(value, undefined, locale) : null;

  const address = site?.data?.address;
  const siteAddress =
    [
      address?.addressLine1,
      address?.city,
      address?.stateProvince,
      address?.postalCode
    ]
      .filter(Boolean)
      .join(", ") || null;

  const priced = (lines.data ?? []).map((line) => ({
    description: line.description || line.item?.name || line.itemId,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.quantity * line.unitPrice
  }));
  const asset = job.data.customerAsset;

  const estimate: ServiceJobEstimate = {
    serviceJobId: job.data.serviceJobId,
    date: date(datetime.today(timeZone).toString()) ?? "",
    customerName: job.data.customer?.name ?? null,
    siteName: site?.data?.name ?? null,
    siteAddress,
    itemName:
      [job.data.item?.readableIdWithRevision, job.data.item?.name]
        .filter(Boolean)
        .join(" ") || null,
    serial: asset?.trackedEntity?.readableId ?? null,
    laborWarranty: date(asset?.laborWarrantyEndDate ?? null),
    partsWarranty: date(asset?.partsWarrantyEndDate ?? null),
    lines: priced.map((line) => ({
      description: line.description,
      quantity: formatQuantity(line.quantity, locale),
      unitPrice: price.format(line.unitPrice),
      amount: money(line.amount)
    })),
    total: money(priced.reduce((sum, line) => sum + line.amount, 0))
  };

  await ensureFont();
  const stream = await renderToStream(
    <ServiceJobEstimatePDF company={company.data as any} estimate={estimate} />
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
    "Content-Disposition": `inline; filename="${company.data.name} - Estimate ${job.data.serviceJobId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
