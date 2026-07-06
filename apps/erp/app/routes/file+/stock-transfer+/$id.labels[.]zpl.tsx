import { requirePermissions } from "@carbon/auth/auth.server";
import { generateProductLabelZPL } from "@carbon/documents/zpl";
import { labelSizes } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getCompany, getDocumentTemplateConfig } from "~/modules/settings";
import { resolveLabelLogo } from "~/modules/settings/labelLogo.server";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";
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
    labelParam || companySettings.data?.productLabelSize || "label2x1";

  const labelSize = labelSizes.find((size) => size.id === labelSizeId);

  if (!labelSize) {
    throw new Error("Invalid label size");
  }

  if (!labelSize.zpl) {
    throw redirect(
      path.to.file.stockTransferLabelsPdf(id, {
        labelSize: labelSize.id,
        lineId: lineIdParam ?? undefined
      })
    );
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

  const zplOutput = items
    .map((item) => generateProductLabelZPL(item, labelSize, template, logo))
    .join("\n");

  return new Response(zplOutput, {
    status: 200,
    headers: {
      "Content-Type": "application/zpl",
      "Content-Disposition": `attachment; filename="labels-${id}.zpl"`
    }
  });
}
