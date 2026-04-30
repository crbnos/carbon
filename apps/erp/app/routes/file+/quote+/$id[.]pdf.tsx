import { requirePermissions } from "@carbon/auth/auth.server";
import { QuotePDF } from "@carbon/documents/pdf";
import type { JSONContent } from "@carbon/react";
import { getPreferenceHeaders } from "@carbon/remix";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCurrencyByCode, getPaymentTermsList } from "~/modules/accounting";
import { getShippingMethodsList } from "~/modules/inventory";
import {
  getQuote,
  getQuoteCustomerDetails,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
  getQuotePayment,
  getQuoteShipment,
  getSalesTerms
} from "~/modules/sales";
import {
  getAccountsReceivableBillingAddress,
  getCompany,
  getCompanySettings
} from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { locale } = getPreferenceHeaders(request);

  const [
    company,
    companySettings,
    arBillingAddress,
    quote,
    quoteLines,
    quoteLinePrices,
    quoteLocations,
    quotePayment,
    quoteShipment,
    paymentTerms,
    terms,
    shippingMethods
  ] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getAccountsReceivableBillingAddress(client, companyId),
    getQuote(client, id),
    getQuoteLines(client, id),
    getQuoteLinePricesByQuoteId(client, id),
    getQuoteCustomerDetails(client, id),
    getQuotePayment(client, id),
    getQuoteShipment(client, id),
    getPaymentTermsList(client, companyId),
    getSalesTerms(client, companyId),
    getShippingMethodsList(client, companyId)
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (quote.error) {
    console.error(quote.error);
  }

  if (quoteLines.error) {
    console.error(quoteLines.error);
  }

  if (quoteLinePrices.error) {
    console.error(quoteLinePrices.error);
  }

  if (quoteLocations.error) {
    console.error(quoteLocations.error);
  }

  if (company.error || quote.error || quoteLocations.error) {
    throw new Error("Failed to load quote");
  }

  const showThumbnails =
    companySettings.data?.includeThumbnailsOnSalesPdfs ?? true;

  let thumbnails: Record<string, string | null> = {};

  if (showThumbnails) {
    const thumbnailPaths = quoteLines.data?.reduce<
      Record<string, string | null>
    >((acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    }, {});

    thumbnails =
      (thumbnailPaths
        ? await Promise.all(
            Object.entries(thumbnailPaths).map(([id, path]) => {
              if (!path) {
                return null;
              }
              return getBase64ImageFromSupabase(client, path).then((data) => ({
                id,
                data
              }));
            })
          )
        : []
      )?.reduce<Record<string, string | null>>((acc, thumbnail) => {
        if (thumbnail) {
          acc[thumbnail.id] = thumbnail.data;
        }
        return acc;
      }, {}) ?? {};
  }

  let exchangeRate = 1;
  if (quote.data?.currencyCode) {
    const currency = await getCurrencyByCode(
      client,
      companyId,
      quote.data.currencyCode
    );
    if (currency.data?.exchangeRate) {
      exchangeRate = currency.data.exchangeRate;
    }
  }

  const stream = await renderToStream(
    <QuotePDF
      company={company.data as any}
      companySettings={companySettings.data}
      locale={locale}
      exchangeRate={exchangeRate}
      quote={quote.data}
      quoteLines={quoteLines.data ?? []}
      quoteLinePrices={quoteLinePrices.data ?? []}
      quoteCustomerDetails={quoteLocations.data}
      payment={quotePayment?.data}
      shipment={quoteShipment?.data}
      accountsReceivableBillingAddress={
        companySettings.data?.accountsReceivableAddress
          ? arBillingAddress.data
          : null
      }
      paymentTerms={paymentTerms.data ?? []}
      shippingMethods={shippingMethods.data ?? []}
      terms={(terms?.data?.salesTerms ?? {}) as JSONContent}
      thumbnails={thumbnails}
    />
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${quote.data.quoteId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
