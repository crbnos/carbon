import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import type { TrackedEntityAttributes } from "@carbon/utils";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getReceiptTracking } from "~/modules/inventory";
import { getCompany, getDocumentTemplateConfig } from "~/modules/settings";
import { resolveLabelLogo } from "~/modules/settings/labelLogo.server";
import { getCompanySettings } from "~/modules/settings/settings.service";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [company, companySettings, receiptLineTracking] = await Promise.all([
    getCompany(client, companyId),
    getCompanySettings(client, companyId),
    getReceiptTracking(client, id, companyId)
  ]);

  if (company.error) {
    console.error(company.error);
    throw new Error("Failed to load company");
  }

  // Get the label size from query params or default to avery5163
  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const lineIdParam = url.searchParams.get("lineId");
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5163";

  // Find the label size configuration
  let labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  let filteredTracking = receiptLineTracking.data;

  // Filter by lineId if provided
  if (lineIdParam) {
    filteredTracking =
      filteredTracking?.filter(
        (tracking) =>
          tracking.attributes &&
          (tracking.attributes as TrackedEntityAttributes)["Receipt Line"] ===
            lineIdParam
      ) ?? [];
  }

  const items = filteredTracking
    ?.map((tracking) => ({
      itemId: tracking.sourceDocumentReadableId ?? "",
      revision: "0",
      number: tracking.readableId ?? "",
      trackedEntityId: tracking.id,
      quantity: tracking.quantity,
      trackingType: tracking.quantity > 1 ? "Batch" : "Serial"
    }))
    .sort((a, b) => {
      if (a.itemId === b.itemId) {
        return a.number.localeCompare(b.number);
      }
      return a.itemId.localeCompare(b.itemId);
    });

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(
      `No items found for receipt ${id}${
        lineIdParam ? ` and line ${lineIdParam}` : ""
      }`,
      { status: 404 }
    );
  }

  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );

  const logo = await resolveLabelLogo(company.data, template, labelSize);

  const stream = await renderToStream(
    <ProductLabelPDF
      items={items ?? []}
      labelSize={labelSize}
      template={template}
      company={company.data as any}
      logo={logo}
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
    "Content-Disposition": `inline; filename="${company.data.name} - Receipt Labels.pdf"`
  });
  return new Response(new Uint8Array(body), { status: 200, headers });
}
