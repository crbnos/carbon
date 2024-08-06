import { QuotePDF } from "@carbon/documents";
import { renderToStream } from "@react-pdf/renderer";
import { type LoaderFunctionArgs } from "@remix-run/node";
import logger from "~/lib/logger";
import {
  getQuote,
  getQuoteCustomerDetails,
  getQuoteLinePricesByQuoteId,
  getQuoteLines,
} from "~/modules/sales";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";
import { requirePermissions } from "~/services/auth/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "sales",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, quote, quoteLines, quoteLinePrices, quoteLocations] =
    await Promise.all([
      getCompany(client, companyId),
      getQuote(client, id),
      getQuoteLines(client, id),
      getQuoteLinePricesByQuoteId(client, id),
      getQuoteCustomerDetails(client, id),
    ]);

  if (company.error) {
    logger.error(company.error);
  }

  if (quote.error) {
    logger.error(quote.error);
  }

  if (quoteLines.error) {
    logger.error(quoteLines.error);
  }

  if (quoteLinePrices.error) {
    logger.error(quoteLinePrices.error);
  }

  if (quoteLocations.error) {
    logger.error(quoteLocations.error);
  }

  if (company.error || quote.error || quoteLocations.error) {
    throw new Error("Failed to load quote");
  }

  const thumbnailPaths = quoteLines.data?.reduce<Record<string, string | null>>(
    (acc, line) => {
      if (line.thumbnailPath) {
        acc[line.id!] = line.thumbnailPath;
      }
      return acc;
    },
    {}
  );

  const thumbnails: Record<string, string | null> =
    (thumbnailPaths
      ? await Promise.all(
          Object.entries(thumbnailPaths).map(([id, path]) => {
            if (!path) {
              return null;
            }
            return getBase64ImageFromSupabase(client, path).then((data) => ({
              id,
              data,
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

  const stream = await renderToStream(
    <QuotePDF
      company={company.data}
      quote={quote.data}
      quoteLines={quoteLines.data ?? []}
      quoteLinePrices={quoteLinePrices.data ?? []}
      quoteCustomerDetails={quoteLocations.data}
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

  const headers = new Headers({ "Content-Type": "application/pdf" });
  return new Response(body, { status: 200, headers });
}
