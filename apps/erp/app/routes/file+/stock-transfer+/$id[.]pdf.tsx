import { requirePermissions } from "@carbon/auth/auth.server";
import { StockTransferPDF } from "@carbon/documents/pdf";
import { getPreferenceHeaders } from "@carbon/remix";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getStockTransfer, getStockTransferLines } from "~/modules/inventory";
import { getCompany } from "~/modules/settings";
import { getBase64ImageFromSupabase } from "~/modules/shared";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, stockTransfer, stockTransferLines] = await Promise.all([
    getCompany(client, companyId),
    getStockTransfer(client, id),
    getStockTransferLines(client, id)
  ]);

  if (company.error) {
    console.error(company.error);
  }

  if (stockTransfer.error) {
    console.error(stockTransfer.error);
  }

  if (stockTransferLines.error) {
    console.error(stockTransferLines.error);
  }

  if (
    company.error ||
    stockTransfer.error ||
    stockTransferLines.error ||
    stockTransfer.data.companyId !== companyId
  ) {
    throw new Error("Failed to load stock transfer");
  }

  // Get location information
  const location = await client
    .from("location")
    .select("*")
    .eq("id", stockTransfer.data.locationId)
    .single();

  if (location.error) {
    console.error(location.error);
    throw new Error("Failed to load location");
  }

  const { locale } = getPreferenceHeaders(request);

  // Get thumbnails for items
  const thumbnailPaths = stockTransferLines.data?.reduce<
    Record<string, string | null>
  >((acc, line) => {
    if (line.thumbnailPath) {
      acc[line.id!] = line.thumbnailPath;
    }
    return acc;
  }, {});

  const thumbnails: Record<string, string | null> =
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

  const stream = await renderToStream(
    <StockTransferPDF
      company={company.data as any}
      stockTransfer={stockTransfer.data}
      stockTransferLines={stockTransferLines.data ?? []}
      location={location.data}
      locale={locale}
      meta={{
        author: "Carbon",
        keywords: "stock transfer",
        subject: "Stock Transfer"
      }}
      title="Stock Transfer"
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
    "Content-Disposition": `inline; filename="${company.data.name} - ${stockTransfer.data.stockTransferId}.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
