import { requirePermissions } from "@carbon/auth/auth.server";
import { ProductLabelPDF } from "@carbon/documents/pdf";
import { labelSizes } from "@carbon/utils";
import { renderToStream } from "@react-pdf/renderer";
import type { LoaderFunctionArgs } from "react-router";
import { getCompany, getDocumentTemplateConfig } from "~/modules/settings";
import { resolveLabelLogo } from "~/modules/settings/labelLogo.server";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { getStockTransferLabelItems } from "./labels.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "inventory"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const url = new URL(request.url);
  const labelParam = url.searchParams.get("labelSize");
  const lineIdParam = url.searchParams.get("lineId");

  const companySettings = await getCompanySettings(client, companyId);
  const labelSizeId =
    labelParam || companySettings.data?.productLabelSize || "avery5163";

  const labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  const items = await getStockTransferLabelItems(
    client,
    companyId,
    id,
    lineIdParam ?? undefined
  );

  if (items.length === 0) {
    return new Response(
      `No tracked items found for stock transfer ${id}${
        lineIdParam ? ` and line ${lineIdParam}` : ""
      }`,
      { status: 404 }
    );
  }

  // Apply the tracking-label template + company logo, same as the other label
  // routes — stock-transfer labels should match the configured layout/branding.
  const template = await getDocumentTemplateConfig(
    client,
    companyId,
    "trackingLabel"
  );
  const company = await getCompany(client, companyId);
  const logo = await resolveLabelLogo(company.data, template, labelSize);

  const stream = await renderToStream(
    <ProductLabelPDF
      items={items}
      labelSize={labelSize}
      template={template}
      company={company.data as never}
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

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Stock Transfer Labels.pdf"`
    }
  });
}
